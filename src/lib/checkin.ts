import { supabase } from "@/integrations/supabase/client";

/** QR payload format: veggiemeet:v1:<meetupId>:<profileId> */
const PREFIX = "veggiemeet:v1:";

export function encodeCheckInPayload(meetupId: string, profileId: string) {
  return `${PREFIX}${meetupId}:${profileId}`;
}

export function decodeCheckInPayload(raw: string): { meetupId: string; profileId: string } | null {
  if (!raw?.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length);
  const [meetupId, profileId] = rest.split(":");
  if (!meetupId || !profileId) return null;
  return { meetupId, profileId };
}

export async function isAttendeeOfMeetup(profileId: string, meetupId: string) {
  const { data } = await supabase
    .from("attendance")
    .select("id")
    .eq("profile_id", profileId)
    .eq("meetup_id", meetupId)
    .neq("status", "cancelled")
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function areAlreadyFriends(aId: string, bId: string) {
  const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
  const { data } = await supabase
    .from("friendships")
    .select("id")
    .eq("profile_a_id", lo)
    .eq("profile_b_id", hi)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export type CheckInAttempt =
  | { kind: "invalid" }
  | { kind: "self" }
  | { kind: "wrong_meetup" }
  | { kind: "not_attendee" }
  | { kind: "already_friends" }
  | { kind: "existing_pending"; requestId: string; targetProfileId: string }
  | { kind: "created"; requestId: string; targetProfileId: string };

/**
 * Handle a scan by the current user (requester) of another attendee's QR.
 */
export async function submitCheckInScan(params: {
  currentProfileId: string;
  currentMeetupId: string;
  scannedPayload: string;
}): Promise<CheckInAttempt> {
  const decoded = decodeCheckInPayload(params.scannedPayload);
  if (!decoded) return { kind: "invalid" };
  if (decoded.profileId === params.currentProfileId) return { kind: "self" };
  if (decoded.meetupId !== params.currentMeetupId) return { kind: "wrong_meetup" };

  // Both must still be attendees.
  const [selfOk, otherOk] = await Promise.all([
    isAttendeeOfMeetup(params.currentProfileId, params.currentMeetupId),
    isAttendeeOfMeetup(decoded.profileId, params.currentMeetupId),
  ]);
  if (!selfOk || !otherOk) return { kind: "not_attendee" };

  if (await areAlreadyFriends(params.currentProfileId, decoded.profileId)) {
    return { kind: "already_friends" };
  }

  // Reuse a pending request if one already exists for this pair+meetup.
  const { data: existing } = await supabase
    .from("check_in_requests")
    .select("id")
    .eq("meetup_id", params.currentMeetupId)
    .eq("requester_profile_id", params.currentProfileId)
    .eq("target_profile_id", decoded.profileId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { kind: "existing_pending", requestId: existing.id, targetProfileId: decoded.profileId };
  }

  const { data: created, error } = await supabase
    .from("check_in_requests")
    .insert({
      meetup_id: params.currentMeetupId,
      requester_profile_id: params.currentProfileId,
      target_profile_id: decoded.profileId,
    })
    .select("id")
    .maybeSingle();
  if (error || !created) return { kind: "invalid" };
  return { kind: "created", requestId: created.id, targetProfileId: decoded.profileId };
}

export async function fetchIncomingRequests(profileId: string, meetupId: string) {
  const { data } = await supabase
    .from("check_in_requests")
    .select("id, requester_profile_id, created_at")
    .eq("target_profile_id", profileId)
    .eq("meetup_id", meetupId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function respondToCheckIn(requestId: string, accept: boolean) {
  const { error } = await supabase
    .from("check_in_requests")
    .update({ status: accept ? "confirmed" : "declined" })
    .eq("id", requestId);
  if (error) throw error;
}
