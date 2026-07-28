import { supabase } from "@/integrations/supabase/client";

export type PlanType =
  | "active"
  | "update"
  | "cancelled"
  | "invitation"
  | "hosting"
  | "upcoming"
  | "follow_up"
  | "past";

export type PlanRole = "host" | "checked_in" | "attendee" | "invitee" | "viewer";
export type PrimaryAction =
  | "check_in"
  | "open_chat"
  | "view_meetup"
  | "review_invitation"
  | "manage_meetup"
  | "view_summary";

export interface PlanItem {
  plan_type: PlanType;
  meetup_id: string;
  title: string;
  image: string | null;
  category: string;
  role: PlanRole;
  date: string;              // YYYY-MM-DD (Meetup local)
  start_time: string;        // HH:MM:SS (Meetup local)
  end_time: string;
  timezone: string | null;
  starts_at: string;         // ISO timestamptz
  ends_at: string;
  meetup_status: "upcoming" | "full" | "in_progress" | "past" | "cancelled";
  host: { id: string; name: string; avatar: string | null };
  location: {
    city: string | null;
    neighborhood: string | null;
    name: string | null;
    address: string | null;
  };
  capacity: number;
  attendee_count: number;
  attendance_state: string | null;
  invitation: null | {
    id: string;
    message: string | null;
    status: "invited" | "viewed" | "declined";
    sender_id: string;
  };
  has_unseen_update: boolean;
  primary_action: PrimaryAction;
  reason_code: PlanType;
  reason_label: string | null;
}

export interface MyPlansResponse {
  needs_attention: PlanItem[];
  upcoming: PlanItem[];
  hosting: PlanItem[];
  past: PlanItem[];
  past_next_cursor: string | null;
  generated_at: string;
}

export async function fetchMyPlans(
  pastCursor: string | null = null,
  pastLimit = 20,
): Promise<MyPlansResponse> {
  const { data, error } = await supabase.rpc("get_my_plans", {
    _past_cursor: pastCursor,
    _past_limit: pastLimit,
  });
  if (error) throw new Error(error.message);
  return (data ?? {
    needs_attention: [],
    upcoming: [],
    hosting: [],
    past: [],
    past_next_cursor: null,
    generated_at: new Date().toISOString(),
  }) as unknown as MyPlansResponse;
}

export async function acknowledgeMeetupUpdate(meetupId: string): Promise<void> {
  await supabase.rpc("acknowledge_meetup_update", { _meetup_id: meetupId });
}

export async function declineMeetupInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_meetup_invitation", {
    _invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
}

export async function leaveMeetup(meetupId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_meetup", { _meetup_id: meetupId });
  if (error) throw new Error(error.message);
}

/* -------------------- formatting helpers (Meetup timezone) -------------------- */

function tzFmt(iso: string, tz: string | null, opts: Intl.DateTimeFormatOptions) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    ...opts,
    timeZone: tz || undefined,
  }).format(d);
}

export function formatPlanDate(plan: PlanItem): string {
  return tzFmt(plan.starts_at, plan.timezone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatPlanTime(plan: PlanItem): string {
  return tzFmt(plan.starts_at, plan.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPlanTimeRange(plan: PlanItem): string {
  const start = tzFmt(plan.starts_at, plan.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = tzFmt(plan.ends_at, plan.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${start} – ${end}`;
}

export function planLocationLabel(plan: PlanItem): string {
  const parts = [plan.location.name, plan.location.neighborhood ?? plan.location.city]
    .filter(Boolean)
    .join(" · ");
  return parts || "Location TBC";
}

/** Group upcoming plans into Today / Tomorrow / This Week / Later using Meetup timezone. */
export type UpcomingGroup = "today" | "tomorrow" | "this_week" | "later";
export function groupUpcoming(plans: PlanItem[]): Record<UpcomingGroup, PlanItem[]> {
  const groups: Record<UpcomingGroup, PlanItem[]> = {
    today: [],
    tomorrow: [],
    this_week: [],
    later: [],
  };
  const now = new Date();
  for (const p of plans) {
    const tz = p.timezone || undefined;
    const meetupDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(p.starts_at));
    const todayDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const diffMs = new Date(p.starts_at).getTime() - now.getTime();
    if (meetupDay === todayDay) groups.today.push(p);
    else if (diffMs < 1000 * 60 * 60 * 24 * 2) groups.tomorrow.push(p);
    else if (diffMs < 1000 * 60 * 60 * 24 * 7) groups.this_week.push(p);
    else groups.later.push(p);
  }
  return groups;
}

/** Group past plans by "Month YYYY" using Meetup timezone. */
export function groupPastByMonth(plans: PlanItem[]): Array<{ label: string; items: PlanItem[] }> {
  const map = new Map<string, PlanItem[]>();
  for (const p of plans) {
    const label = tzFmt(p.starts_at, p.timezone, { month: "long", year: "numeric" });
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(p);
  }
  return Array.from(map, ([label, items]) => ({ label, items }));
}
