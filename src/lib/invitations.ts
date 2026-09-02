import { supabase } from "@/integrations/supabase/client";
import { FALLBACK_COVER, sanitizeCover } from "@/lib/backend";

export const PERSONAL_MESSAGE_MAX = 300;
export const DEFAULT_INVITATION_MESSAGE = "Want to join me for this Meetup?";

export type InvitationStatus = "invited" | "viewed" | "joined";

export interface InvitationMeetupSummary {
  id: string;
  title: string;
  category: string;
  /** WO-126A — canonical Primary interest id. */
  primaryInterestId: string | null;
  coverImageUrl: string;
  date: string;
  startTime: string;
  hostId: string;
  hostName: string;
  locationLabel: string | null;
  capacity: number;
  attendeeCount: number;
  status: "upcoming" | "cancelled" | "ended" | "full";
}

export interface EligibleMeetup extends InvitationMeetupSummary {
  eligible: boolean;
  reason?: string;
  recipientAttending?: boolean;
}

export interface InvitationRecord {
  id: string;
  meetup_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  personal_message: string;
  status: InvitationStatus;
  created_at: string;
  viewed_at: string | null;
  joined_at: string | null;
}

export interface HydratedInvitation {
  invitation: InvitationRecord;
  meetup: InvitationMeetupSummary;
  recipientAttending: boolean;
}

interface MeetupRow {
  id: string;
  title: string;
  category: string;
  primary_interest_id: string | null;
  cover_image_url: string | null;
  host_id: string;
  date: string;
  start_time: string;
  capacity: number;
  status: string;
  community_place_id: string | null;
  custom_location_name: string | null;
  profiles?: { display_name: string } | null;
  community_places?: { name: string } | null;
}

function toSummary(row: MeetupRow, attendeeCount: number): InvitationMeetupSummary {
  const nowDate = new Date();
  const startsAt = new Date(`${row.date}T${row.start_time}`);
  let derivedStatus: InvitationMeetupSummary["status"] = "upcoming";
  if (row.status === "cancelled") derivedStatus = "cancelled";
  else if (startsAt.getTime() < nowDate.getTime()) derivedStatus = "ended";
  else if (attendeeCount >= row.capacity) derivedStatus = "full";
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    primaryInterestId: row.primary_interest_id ?? null,
    coverImageUrl: sanitizeCover(row.cover_image_url),
    date: row.date,
    startTime: (row.start_time || "").slice(0, 5),
    hostId: row.host_id,
    hostName: row.profiles?.display_name ?? "Host",
    locationLabel:
      row.custom_location_name ?? row.community_places?.name ?? null,
    capacity: row.capacity,
    attendeeCount,
    status: derivedStatus,
  };
}

/**
 * Meetups the sender is hosting or confirmed attending, filtered to upcoming.
 * Each item is marked eligible or ineligible with a reason so the sheet can
 * display disabled rows explaining why.
 */
export async function fetchEligibleMeetups(
  senderProfileId: string,
  recipientProfileId: string,
): Promise<EligibleMeetup[]> {
  const today = new Date().toISOString().slice(0, 10);

  const meetupsQuery = supabase
    .from("meetups")
    .select(
      "id, title, category, primary_interest_id, cover_image_url, host_id, date, start_time, capacity, status, community_place_id, custom_location_name, profiles:host_id(display_name), community_places:community_place_id(name)",
    )
    .gte("date", today)
    .order("date")
    .order("start_time");

  const attendanceQuery = supabase
    .from("attendance")
    .select("meetup_id, status")
    .eq("profile_id", senderProfileId)
    .not("status", "in", "(cancelled,removed)");


  const [{ data: mData }, { data: aData }] = await Promise.all([
    meetupsQuery,
    attendanceQuery,
  ]);

  const attendingIds = new Set((aData ?? []).map((r) => r.meetup_id as string));
  const meetups = (mData ?? []) as unknown as MeetupRow[];
  const asSender = meetups.filter(
    (m) => m.host_id === senderProfileId || attendingIds.has(m.id),
  );
  if (asSender.length === 0) return [];

  const ids = asSender.map((m) => m.id);
  const { data: attRows } = await supabase
    .from("attendance")
    .select("meetup_id, profile_id, status")
    .in("meetup_id", ids)
    .not("status", "in", "(cancelled,removed)");

  const rows = (attRows ?? []) as { meetup_id: string; profile_id: string }[];
  const counts = new Map<string, number>();
  const recipientAtt = new Set<string>();
  for (const r of rows) {
    counts.set(r.meetup_id, (counts.get(r.meetup_id) ?? 0) + 1);
    if (r.profile_id === recipientProfileId) recipientAtt.add(r.meetup_id);
  }

  const { data: invRows } = await supabase
    .from("meetup_invitations")
    .select("meetup_id, recipient_id")
    .in("meetup_id", ids)
    .eq("sender_id", senderProfileId)
    .eq("recipient_id", recipientProfileId);
  const alreadyInvited = new Set((invRows ?? []).map((r) => r.meetup_id as string));

  return asSender.map((m) => {
    const summary = toSummary(m, counts.get(m.id) ?? 0);
    const recipientAttending = recipientAtt.has(m.id);
    let eligible = true;
    let reason: string | undefined;
    if (summary.status === "cancelled") {
      eligible = false;
      reason = "Meetup cancelled";
    } else if (summary.status === "ended") {
      eligible = false;
      reason = "Meetup has started";
    } else if (recipientAttending) {
      eligible = false;
      reason = "Already attending";
    } else if (summary.status === "full") {
      eligible = false;
      reason = "Meetup full";
    } else if (alreadyInvited.has(m.id)) {
      eligible = false;
      reason = "Already invited";
    }
    return { ...summary, eligible, reason, recipientAttending };
  });
}

export async function createInvitation(
  meetupId: string,
  recipientProfileId: string,
  personalMessage: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_meetup_invitation", {
    _meetup_id: meetupId,
    _recipient_id: recipientProfileId,
    _personal_message: personalMessage,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function markInvitationViewed(invitationId: string): Promise<void> {
  await supabase.rpc("mark_invitation_viewed", { _invitation_id: invitationId });
}

export async function joinFromInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc("join_from_invitation", {
    _invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Load invitation records plus their meetup summaries for a set of IDs. Also
 * returns whether the current profile is attending each meetup so the card can
 * show a live "Joined" chip even if the stored status hasn't been updated.
 */
export async function fetchInvitationsBundle(
  invitationIds: string[],
  meProfileId: string,
): Promise<Map<string, HydratedInvitation>> {
  const out = new Map<string, HydratedInvitation>();
  if (invitationIds.length === 0) return out;
  const { data: invs } = await supabase
    .from("meetup_invitations")
    .select("*")
    .in("id", invitationIds);
  const invitations = (invs ?? []) as unknown as InvitationRecord[];
  if (invitations.length === 0) return out;

  const meetupIds = Array.from(new Set(invitations.map((i) => i.meetup_id)));
  const { data: meetupRows } = await supabase
    .from("meetups")
    .select(
      "id, title, category, primary_interest_id, cover_image_url, host_id, date, start_time, capacity, status, community_place_id, custom_location_name, profiles:host_id(display_name), community_places:community_place_id(name)",
    )
    .in("id", meetupIds);
  const meetups = (meetupRows ?? []) as unknown as MeetupRow[];

  const { data: attRows } = await supabase
    .from("attendance")
    .select("meetup_id, profile_id, status")
    .in("meetup_id", meetupIds)
    .not("status", "in", "(cancelled,removed)");

  const counts = new Map<string, number>();
  const attendingByProfile = new Map<string, Set<string>>();
  for (const r of attRows ?? []) {
    const mid = r.meetup_id as string;
    counts.set(mid, (counts.get(mid) ?? 0) + 1);
    if (!attendingByProfile.has(mid)) attendingByProfile.set(mid, new Set());
    attendingByProfile.get(mid)!.add(r.profile_id as string);
  }

  const byId = new Map(meetups.map((m) => [m.id, m]));
  for (const inv of invitations) {
    const row = byId.get(inv.meetup_id);
    if (!row) continue;
    const summary = toSummary(row, counts.get(inv.meetup_id) ?? 0);
    out.set(inv.id, {
      invitation: inv,
      meetup: summary,
      recipientAttending:
        attendingByProfile.get(inv.meetup_id)?.has(inv.recipient_id) ?? false,
    });
  }

  return out;
}

export function fallbackCover(url?: string | null): string {
  return url && url.length > 0 ? url : FALLBACK_COVER;
}

/**
 * WO-144A addendum (DEF-144A-01) — the host's optional personal message was
 * stored on network invitations (no conversation) but never surfaced to the
 * recipient anywhere. This loads the viewer's own invitation for a Meetup so
 * the message can be shown in its private invitation context.
 *
 * Privacy: `meetup_invitations` RLS restricts SELECT to the sender or the
 * recipient of the row, so no other member can retrieve it.
 */
export interface ViewerInvitationNote {
  invitationId: string;
  personalMessage: string;
  senderName: string;
  createdAt: string;
}

export async function fetchViewerInvitationNote(
  meetupId: string,
  viewerProfileId: string,
): Promise<ViewerInvitationNote | null> {
  const { data, error } = await supabase
    .from("meetup_invitations")
    .select("id, personal_message, created_at, sender_id, profiles:sender_id(display_name)")
    .eq("meetup_id", meetupId)
    .eq("recipient_id", viewerProfileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    personal_message: string | null;
    created_at: string;
    profiles?: { display_name: string | null } | null;
  };
  const message = (row.personal_message ?? "").trim();
  if (!message) return null;
  return {
    invitationId: row.id,
    personalMessage: message,
    senderName: row.profiles?.display_name ?? "Your host",
    createdAt: row.created_at,
  };
}
