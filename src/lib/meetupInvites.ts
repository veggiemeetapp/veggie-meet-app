import { supabase } from "@/integrations/supabase/client";

/**
 * WO-144 — host-initiated multi-select Meetup invitations.
 *
 * Authorization, connection state, capacity, duplicate suppression and the
 * rolling invitation quota are all enforced by `public.send_meetup_invitations`.
 * This module is a thin, typed transport around the two RPCs.
 *
 * WO-144B — abuse control contract:
 *  - at most {@link INVITE_SELECTION_MAX} recipients per send action;
 *  - at most {@link INVITE_DAILY_LIMIT} *newly created* invitations per host per
 *    rolling 24 hours (window = trailing 24h ending at the server statement
 *    time; nothing resets at midnight);
 *  - skipped recipients never consume allowance;
 *  - a sender-scoped advisory lock serialises simultaneous batches across
 *    different Meetups, so the quota cannot be raced.
 */

export const INVITE_SELECTION_MAX = 20;
export const INVITE_MESSAGE_MAX = 300;
/** Beta ceiling: newly created invitations per host per rolling 24 hours. */
export const INVITE_DAILY_LIMIT = 50;

export interface InviteCandidate {
  profileId: string;
  displayName: string;
  firstName: string;
  avatarUrl: string | null;
  cityName: string | null;
  alreadyAttending: boolean;
  alreadyInvited: boolean;
  invitationStatus: string | null;
}

export type SkipReason =
  | "already_invited"
  | "already_attending"
  | "not_connected"
  | "unavailable"
  | "rate_limited"
  | "blocked";

export interface SendInvitationsResult {
  invitedCount: number;
  invitationIds: string[];
  skipped: { profileId: string; reason: SkipReason }[];
  /** Rolling allowance ceiling reported by the server. */
  dailyLimit: number;
  /** Newly created invitations still available in the current window. */
  remaining: number;
  /** Length of the rolling window in hours. */
  windowHours: number;
  /** ISO timestamp at which the current rolling window begins. */
  windowStart: string | null;
}

export function candidateSelectable(c: InviteCandidate): boolean {
  return !c.alreadyAttending && !c.alreadyInvited;
}

/** True when the batch was fully blocked by the rolling invitation quota. */
export function isRateLimited(result: SendInvitationsResult): boolean {
  return (
    result.invitedCount === 0 &&
    result.skipped.length > 0 &&
    result.skipped.some((s) => s.reason === "rate_limited")
  );
}


interface InviteCandidateRow {
  profile_id: string;
  display_name: string | null;
  first_name: string | null;
  avatar_url: string | null;
  city_name: string | null;
  already_attending: boolean | null;
  already_invited: boolean | null;
  invitation_status: string | null;
}

export async function fetchInviteCandidates(
  meetupId: string,
): Promise<InviteCandidate[]> {
  const { data, error } = await supabase.rpc("get_meetup_invite_candidates", {
    _meetup_id: meetupId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as InviteCandidateRow[]).map((r) => ({
    profileId: r.profile_id,
    displayName: r.display_name ?? "Veggie",
    firstName: r.first_name ?? "Veggie",
    avatarUrl: r.avatar_url ?? null,
    cityName: r.city_name ?? null,
    alreadyAttending: !!r.already_attending,
    alreadyInvited: !!r.already_invited,
    invitationStatus: r.invitation_status ?? null,
  }));
}

export async function sendMeetupInvitations(
  meetupId: string,
  recipientIds: string[],
  personalMessage?: string,
): Promise<SendInvitationsResult> {
  const { data, error } = await supabase.rpc("send_meetup_invitations", {
    _meetup_id: meetupId,
    _recipient_ids: recipientIds,
    _personal_message: personalMessage ?? null,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as {
    invited_count?: number;
    invitation_ids?: string[];
    skipped?: { profile_id: string; reason: SkipReason }[];
    daily_limit?: number;
    remaining?: number;
    window_hours?: number;
    window_start?: string;
  };
  return {
    invitedCount: payload.invited_count ?? 0,
    invitationIds: payload.invitation_ids ?? [],
    skipped: (payload.skipped ?? []).map((s) => ({
      profileId: s.profile_id,
      reason: s.reason,
    })),
    dailyLimit: payload.daily_limit ?? INVITE_DAILY_LIMIT,
    remaining: payload.remaining ?? 0,
    windowHours: payload.window_hours ?? 24,
    windowStart: payload.window_start ?? null,
  };
}

export function skipReasonLabel(reason: SkipReason): string {
  switch (reason) {
    case "already_invited":
      return "already invited";
    case "already_attending":
      return "already attending";
    case "not_connected":
      return "no longer connected";
    case "rate_limited":
      return "daily invitation limit reached";
    default:
      return "unavailable";
  }
}


/** Human summary of a send result, used for the confirmation toast. */
export function sendResultSummary(
  result: SendInvitationsResult,
  nameFor: (profileId: string) => string,
): { title: string; description?: string } {
  if (isRateLimited(result)) {
    return {
      title: "Daily invitation limit reached",
      description: `You can send up to ${result.dailyLimit} invitations every ${result.windowHours} hours. Please try again later.`,
    };
  }
  const title =
    result.invitedCount === 0
      ? "No invitations sent"
      : `${result.invitedCount} invitation${result.invitedCount === 1 ? "" : "s"} sent`;
  if (result.skipped.length === 0) return { title };

  const parts = result.skipped
    .slice(0, 3)
    .map((s) => `${nameFor(s.profileId)} — ${skipReasonLabel(s.reason)}`);
  const extra = result.skipped.length - parts.length;
  return {
    title,
    description:
      `Skipped: ${parts.join(", ")}` + (extra > 0 ? ` and ${extra} more.` : "."),
  };
}
