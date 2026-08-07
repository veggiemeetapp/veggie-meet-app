import { supabase } from "@/integrations/supabase/client";
import { logAnalyticsEvent } from "@/lib/analytics";

/**
 * WO-063 — Meetup completion & Hosting Impact integrity.
 *
 * Completion is server authoritative: the client can only ask, never assert.
 * `get_meetup_lifecycle` is the single member-safe read model for every surface
 * (detail, management, past listings) — no per-card RPC fan-out.
 */

export type MeetupLifecycleState =
  | "upcoming"
  | "in_progress"
  | "ended"
  | "completed"
  | "cancelled";

export type CompletionBlockedReason =
  | "cancelled"
  | "not_ended"
  | "no_checked_in_attendees"
  | null;

export interface MeetupLifecycle {
  meetup_id: string;
  lifecycle_state: MeetupLifecycleState;
  has_started: boolean;
  has_ended: boolean;
  is_completed: boolean;
  completed_at: string | null;
  counts_toward_hosting_impact: boolean;
  is_host: boolean;
  can_complete: boolean;
  blocked_reason: CompletionBlockedReason;
  server_time: string;
}

export async function fetchMeetupLifecycle(
  meetupId: string,
): Promise<MeetupLifecycle> {
  const { data, error } = await (supabase.rpc as any)("get_meetup_lifecycle", {
    _meetup_id: meetupId,
  });
  if (error) throw new Error(error.message);
  return data as MeetupLifecycle;
}

export type CompletionResult = {
  result: "completed" | "already_completed";
  completed_at: string | null;
};

/** Idempotent. A second call resolves with `already_completed`. */
export async function completeHostedMeetup(
  meetupId: string,
): Promise<CompletionResult> {
  logAnalyticsEvent("meetup_completion_started", { meetup_id: meetupId });
  const { data, error } = await (supabase.rpc as any)("complete_hosted_meetup", {
    _meetup_id: meetupId,
  });
  if (error) {
    logAnalyticsEvent("meetup_completion_blocked", { reason: "server_rejected" });
    throw new Error(error.message);
  }
  const res = data as CompletionResult;
  logAnalyticsEvent("meetup_completion_completed", {
    meetup_id: meetupId,
    result: res.result,
  });
  return res;
}

/** Member-safe copy. Never claims a member physically attended. */
export function lifecycleLabel(state: MeetupLifecycleState): string {
  switch (state) {
    case "completed":
      return "Meetup completed";
    case "ended":
      return "This Meetup has ended";
    case "in_progress":
      return "Happening now";
    case "cancelled":
      return "Meetup cancelled";
    default:
      return "Upcoming";
  }
}

export function blockedReasonCopy(reason: CompletionBlockedReason): string | null {
  switch (reason) {
    case "not_ended":
      return "You can finish this Meetup once its scheduled end time has passed.";
    case "no_checked_in_attendees":
      return "At least one other Veggie needs to be checked in before this Meetup can be completed.";
    case "cancelled":
      return "Cancelled Meetups can't be completed.";
    default:
      return null;
  }
}
