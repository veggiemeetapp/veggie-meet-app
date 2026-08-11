import { supabase } from "@/integrations/supabase/client";

/**
 * WO-097 — beta cohort activation operations (owner only).
 *
 * Every number rendered by the owner activation section comes from the
 * `get_beta_activation_summary()` SECURITY DEFINER RPC, which:
 *
 *  - checks `is_owner()` server-side (no client-only gate),
 *  - aggregates inside a bounded window (Today / 7d / 30d) over an explicit
 *    event allowlist, so no unbounded historical scan is possible,
 *  - returns counts only: no profile ids, names, emails, coordinates, message
 *    content or raw analytics payloads ever cross the wire.
 *
 * Members vs events: `members` is `count(distinct profile_id)` derived from the
 * server-side actor on each row. `events` is raw row volume. The dashboard
 * labels the two separately and never treats event volume as member reach.
 */

export type ActivationWindow = "today" | "7d" | "30d";

export const ACTIVATION_WINDOWS: { id: ActivationWindow; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

/**
 * Level-2 "community action" definition (documented, must not drift silently).
 * A member counts once if they emitted at least one of these in the window:
 *   meetup_created, meetup_joined, connection_request_sent,
 *   connection_request_accepted, community_place_check_in_succeeded,
 *   community_place_suggestion_submitted
 * Deduplication is `count(distinct profile_id)` server-side.
 */
export const COMMUNITY_ACTION_EVENTS = [
  "meetup_created",
  "meetup_joined",
  "connection_request_sent",
  "connection_request_accepted",
  "community_place_check_in_succeeded",
  "community_place_suggestion_submitted",
] as const;

export interface ActivationCount {
  members: number;
  events: number;
}

export interface ActivationSummary {
  window: ActivationWindow;
  window_start: string;
  generated_at: string;
  product_timezone: string;
  total_events: number;
  events: Record<string, ActivationCount | undefined>;
  stages: {
    joined: number;
    reached_today: number;
    explored_community: number;
    viewed_place: number;
    opened_host: number;
    opened_meet: number;
    community_action: number;
  };
  today_and_community_members: number;
  onboarding_steps: { step: string; members: number; events: number }[];
}

export async function fetchActivationSummary(
  window: ActivationWindow,
): Promise<ActivationSummary> {
  const { data, error } = await supabase.rpc("get_beta_activation_summary", {
    _window: window,
  });
  if (error) throw error;
  return data as unknown as ActivationSummary;
}

/** Members for an event, or 0 when the event never occurred in the window. */
export function members(s: ActivationSummary, event: string): number {
  return s.events?.[event]?.members ?? 0;
}

/** Raw event volume for an event in the window. */
export function eventCount(s: ActivationSummary, event: string): number {
  return s.events?.[event]?.events ?? 0;
}

/**
 * Conversion share. Returns null (rendered as "—") whenever the denominator is
 * zero or either side is not a finite number, so NaN / Infinity / a misleading
 * "100%" can never appear.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function formatRatio(numerator: number, denominator: number): string {
  const r = ratio(numerator, denominator);
  if (r === null) return "—";
  return `${Math.round(r * 100)}%`;
}

export const ONBOARDING_STEP_LABEL: Record<string, string> = {
  welcome: "Welcome",
  auth: "Create account",
  identity: "Name",
  dietary: "Dietary identity",
  home_city: "Home city",
  selected_city: "City you're in",
  interests: "Interests",
  photo: "Photo",
  guidelines: "Community guidelines",
  safety: "Safety",
};

/**
 * Largest aggregate step-to-step drop in onboarding reach. Observational only:
 * returns null unless there is a real positive drop between two adjacent steps
 * that both had activity, so sparse beta data is never dramatized.
 */
export function biggestOnboardingDrop(
  steps: { step: string; members: number }[],
): { from: string; to: string; drop: number } | null {
  let best: { from: string; to: string; drop: number } | null = null;
  for (let i = 0; i < steps.length - 1; i += 1) {
    const a = steps[i];
    const b = steps[i + 1];
    if (a.members <= 0) continue;
    const drop = a.members - b.members;
    if (drop <= 0) continue;
    if (!best || drop > best.drop) best = { from: a.step, to: b.step, drop };
  }
  return best;
}

/** Ordered activation stages for the vertical step list. */
export function activationStages(
  s: ActivationSummary,
): { key: string; label: string; members: number }[] {
  const st = s.stages;
  return [
    { key: "joined", label: "Completed onboarding", members: st?.joined ?? 0 },
    { key: "reached_today", label: "Reached Today", members: st?.reached_today ?? 0 },
    {
      key: "explored_community",
      label: "Explored Community",
      members: st?.explored_community ?? 0,
    },
    { key: "viewed_place", label: "Viewed a Place", members: st?.viewed_place ?? 0 },
    { key: "opened_host", label: "Opened Host", members: st?.opened_host ?? 0 },
    { key: "opened_meet", label: "Opened Meet Veggies", members: st?.opened_meet ?? 0 },
    {
      key: "community_action",
      label: "Community action",
      members: st?.community_action ?? 0,
    },
  ];
}

/** True when the window contains no member activity at all. */
export function isEmptyActivation(s: ActivationSummary): boolean {
  return (s.total_events ?? 0) === 0;
}

/** Truthful staleness label from the server-generated timestamp. */
export function updatedLabel(generatedAt: string | undefined): string {
  if (!generatedAt) return "";
  const t = new Date(generatedAt).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins <= 0) return "Updated just now";
  if (mins === 1) return "Updated 1 minute ago";
  if (mins < 60) return `Updated ${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "Updated 1 hour ago" : `Updated ${hrs} hours ago`;
}
