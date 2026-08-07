import { supabase } from "@/integrations/supabase/client";
import { logAnalyticsEvent } from "@/lib/analytics";

/**
 * WO-066 — Meetup attendance check-in integrity.
 *
 * Attendance state is server authoritative: the client can only ask.
 * Members hold no INSERT/UPDATE privilege on `attendance`; every transition
 * runs through a validated SECURITY DEFINER RPC (`join_meetup`,
 * `leave_meetup`, `check_in_to_meetup`, `remove_meetup_attendee`).
 */

export type AttendanceStatus =
  | "joined"
  | "checked_in"
  | "attended"
  | "cancelled"
  | "removed";

export interface MyAttendance {
  status: AttendanceStatus;
  checkedInAt: string | null;
}

export async function fetchMyAttendance(
  meetupId: string,
  profileId: string,
): Promise<MyAttendance | null> {
  const { data, error } = await supabase
    .from("attendance")
    .select("status, checked_in_at, updated_at")
    .eq("meetup_id", meetupId)
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const row = data[0] as { status: string; checked_in_at: string | null };
  return { status: row.status as AttendanceStatus, checkedInAt: row.checked_in_at };
}

export type CheckInBlockedReason =
  | "too_early"
  | "closed"
  | "cancelled"
  | "completed"
  | "not_joined"
  | "removed"
  | "invalid";

export type CheckInResult =
  | { result: "checked_in" | "already_checked_in"; checkedInAt: string | null }
  | { result: "blocked"; reason: CheckInBlockedReason };

/** Idempotent. A second call resolves with `already_checked_in`. */
export async function checkInToMeetup(meetupId: string): Promise<CheckInResult> {
  logAnalyticsEvent("meetup_check_in_started", { meetup_id: meetupId });
  const { data, error } = await (supabase.rpc as any)("check_in_to_meetup", {
    _meetup_id: meetupId,
  });
  if (error) {
    logAnalyticsEvent("meetup_check_in_blocked", { reason: "server_rejected" });
    throw new Error(error.message);
  }
  const d = data as any;
  if (d?.result === "blocked") {
    logAnalyticsEvent("meetup_check_in_blocked", {
      meetup_id: meetupId,
      reason: d.reason,
    });
    return { result: "blocked", reason: d.reason as CheckInBlockedReason };
  }
  logAnalyticsEvent("meetup_check_in_completed", {
    meetup_id: meetupId,
    result: d?.result,
  });
  return {
    result: d?.result === "already_checked_in" ? "already_checked_in" : "checked_in",
    checkedInAt: (d?.checked_in_at as string | null) ?? null,
  };
}

/** Member-safe copy. Never blames the member for a timing rule. */
export function checkInBlockedCopy(reason: CheckInBlockedReason): string {
  switch (reason) {
    case "too_early":
      return "Check-in opens an hour before the Meetup starts.";
    case "closed":
      return "Check-in for this Meetup has closed.";
    case "cancelled":
      return "This Meetup was cancelled.";
    case "completed":
      return "This Meetup is complete, so attendance can no longer change.";
    case "not_joined":
      return "Join this Meetup before checking in.";
    case "removed":
      return "You're no longer attending this Meetup.";
    default:
      return "Check-in isn't available right now.";
  }
}
