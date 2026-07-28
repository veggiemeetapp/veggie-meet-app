import { supabase } from "@/integrations/supabase/client";

export type FeedbackRating = "great" | "okay" | "not_for_me";

export interface VerifiedPeer {
  id: string;
  display_name: string;
  avatar_url: string | null;
  interests: string[] | null;
}

export interface MyMeetupSummary {
  meetup: {
    id: string;
    title: string;
    description: string;
    date: string;
    start_time: string;
    end_time: string | null;
    cover_image_url: string | null;
    custom_location_name: string | null;
    custom_location_address: string | null;
    status: string;
    cancelled_at: string | null;
    has_ended: boolean;
  };
  host: { id: string; display_name: string; avatar_url: string | null } | null;
  place: { id: string; name: string; cover_image_url: string | null; address: string | null } | null;
  attendance_status: "joined" | "checked_in" | "attended" | "cancelled" | "removed";
  is_host: boolean;
  verified_connections: VerifiedPeer[];
  feedback: {
    id: string;
    rating: FeedbackRating;
    private_note: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export interface HostMeetupSummary {
  meetup: {
    id: string;
    title: string;
    date: string;
    start_time: string;
    end_time: string | null;
    status: string;
    has_ended: boolean;
  };
  confirmed_count: number;
  checked_in_count: number;
  attendance_rate: number | null;
  verified_connections_count: number;
  feedback: {
    total: number;
    threshold_met: boolean;
    great: number | null;
    okay: number | null;
    not_for_me: number | null;
  };
}

export async function getMyMeetupSummary(meetupId: string): Promise<MyMeetupSummary> {
  const { data, error } = await supabase.rpc("get_my_meetup_summary", { _meetup_id: meetupId });
  if (error) throw new Error(error.message);
  return data as unknown as MyMeetupSummary;
}

export async function getHostMeetupSummary(meetupId: string): Promise<HostMeetupSummary> {
  const { data, error } = await supabase.rpc("get_host_meetup_summary", { _meetup_id: meetupId });
  if (error) throw new Error(error.message);
  return data as unknown as HostMeetupSummary;
}

export async function submitMeetupFeedback(meetupId: string, rating: FeedbackRating, note: string | null) {
  const { data, error } = await supabase.rpc("submit_meetup_feedback", {
    _meetup_id: meetupId,
    _rating: rating,
    _note: note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function markFollowUpViewed(meetupId: string) {
  await supabase.rpc("mark_meetup_follow_up_viewed", { _meetup_id: meetupId });
}

export async function dismissFollowUp(meetupId: string) {
  await supabase.rpc("dismiss_meetup_follow_up", { _meetup_id: meetupId });
}

export async function reportMeetup(meetupId: string, reason: string, details: string | null) {
  const { data, error } = await supabase.rpc("report_meetup", {
    _meetup_id: meetupId,
    _reason: reason,
    _details: details,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Find an eligible pending follow-up prompt for the current profile. */
export interface PendingFollowUp {
  meetupId: string;
  title: string;
  coverImageUrl: string | null;
  endedAt: string;
}

export async function fetchPendingFollowUp(profileId: string): Promise<PendingFollowUp | null> {
  // Attendance rows for checked-in/attended, meetup ended, not cancelled
  const { data: att } = await supabase
    .from("attendance")
    .select("meetup_id, status, meetups!inner(id, title, cover_image_url, date, start_time, end_time, status)")
    .eq("profile_id", profileId)
    .in("status", ["checked_in", "attended"]);
  if (!att || att.length === 0) return null;

  const now = Date.now();
  const candidates = (att as any[])
    .map((r) => r.meetups)
    .filter((m) => m && m.status !== "cancelled")
    .filter((m) => {
      const end = new Date(`${m.date}T${(m.end_time || m.start_time)}`);
      return end.getTime() <= now;
    })
    .sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
  if (candidates.length === 0) return null;

  // Check follow-up state for these meetups
  const ids = candidates.map((m) => m.id);
  const { data: states } = await supabase
    .from("meetup_follow_up_state")
    .select("meetup_id, dismissed_at, viewed_at")
    .eq("profile_id", profileId)
    .in("meetup_id", ids);
  const seen = new Set(
    (states ?? [])
      .filter((s: any) => s.dismissed_at || s.viewed_at)
      .map((s: any) => s.meetup_id),
  );
  const next = candidates.find((m) => !seen.has(m.id));
  if (!next) return null;
  return {
    meetupId: next.id,
    title: next.title,
    coverImageUrl: next.cover_image_url,
    endedAt: `${next.date}T${next.end_time || next.start_time}`,
  };
}

/** Past Meetups for history (hosted or attended, ended). */
export interface PastMeetupItem {
  id: string;
  title: string;
  date: string;
  startTime: string;
  coverImageUrl: string | null;
  isHost: boolean;
  attendanceStatus: string | null;
  cancelled: boolean;
}

export async function fetchPastMeetups(profileId: string): Promise<PastMeetupItem[]> {
  const [hostedRes, attendingRes] = await Promise.all([
    supabase
      .from("meetups")
      .select("id,title,date,start_time,end_time,cover_image_url,status")
      .eq("host_id", profileId),
    supabase
      .from("attendance")
      .select("status, meetups!inner(id,title,date,start_time,end_time,cover_image_url,status,host_id)")
      .eq("profile_id", profileId),
  ]);

  const now = Date.now();
  const byId = new Map<string, PastMeetupItem>();

  for (const m of (hostedRes.data ?? []) as any[]) {
    const end = new Date(`${m.date}T${(m.end_time || m.start_time)}`);
    if (end.getTime() > now && m.status !== "cancelled") continue;
    byId.set(m.id, {
      id: m.id,
      title: m.title,
      date: m.date,
      startTime: (m.start_time || "").slice(0, 5),
      coverImageUrl: m.cover_image_url,
      isHost: true,
      attendanceStatus: "hosted",
      cancelled: m.status === "cancelled",
    });
  }

  for (const row of (attendingRes.data ?? []) as any[]) {
    const m = row.meetups;
    if (!m) continue;
    if (m.host_id === profileId) continue; // already covered by hostedRes
    if (row.status === "cancelled") continue;
    const end = new Date(`${m.date}T${(m.end_time || m.start_time)}`);
    if (end.getTime() > now && m.status !== "cancelled") continue;
    byId.set(m.id, {
      id: m.id,
      title: m.title,
      date: m.date,
      startTime: (m.start_time || "").slice(0, 5),
      coverImageUrl: m.cover_image_url,
      isHost: false,
      attendanceStatus: row.status,
      cancelled: m.status === "cancelled",
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    (b.date + b.startTime).localeCompare(a.date + a.startTime),
  );
}
