import { supabase } from "@/integrations/supabase/client";
import { APP_VERSION } from "@/lib/appVersion";

/**
 * WO-089 — private beta feedback.
 *
 * A narrow, canonical, owner-only-readable channel for non-safety product
 * feedback. Actor attribution is server-derived inside submit_beta_feedback();
 * the client never supplies a profile id. Safety, member, Meetup and Community
 * Place reporting remain entirely separate systems.
 */

export const FEEDBACK_CATEGORIES = [
  { id: "bug", label: "Bug" },
  { id: "confusing", label: "Confusing" },
  { id: "suggestion", label: "Suggestion" },
  { id: "other", label: "Other" },
] as const;

export const FEEDBACK_SURFACES = [
  { id: "today", label: "Today" },
  { id: "community", label: "Community" },
  { id: "search", label: "Search" },
  { id: "profile", label: "Profile" },
  { id: "meetup", label: "Meetup" },
  { id: "chats", label: "Chats" },
  { id: "notifications", label: "Notifications" },
  { id: "you", label: "You" },
  { id: "settings", label: "Settings" },
  { id: "community_place", label: "Community Place" },
  { id: "other", label: "Other" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["id"];
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number]["id"];
export type FeedbackStatus =
  | "new"
  | "reviewing"
  | "planned"
  | "resolved"
  | "wont_fix";

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  planned: "Planned",
  resolved: "Resolved",
  wont_fix: "Won't fix",
};

export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 2000;

export async function submitBetaFeedback(input: {
  category: FeedbackCategory;
  surface: FeedbackSurface;
  message: string;
  routeTemplate?: string | null;
  clientToken?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("submit_beta_feedback", {
    _category: input.category,
    _surface: input.surface,
    _message: input.message.trim(),
    _app_version: APP_VERSION,
    _route_template: input.routeTemplate ?? null,
    _client_token: input.clientToken ?? null,
  });
  if (error) throw error;
  return data as unknown as string;
}

export interface BetaFeedbackItem {
  id: string;
  category: FeedbackCategory;
  surface: FeedbackSurface;
  message: string;
  app_version: string | null;
  route_template: string | null;
  status: FeedbackStatus;
  internal_note: string | null;
  created_at: string;
  updated_at: string;
  profile_id: string | null;
  member_label: string;
  member_removed: boolean;
}

export interface BetaFeedbackQueue {
  items: BetaFeedbackItem[];
  counts: Partial<Record<FeedbackStatus, number>>;
  total: number;
}

export async function fetchBetaFeedbackQueue(
  status: FeedbackStatus | null,
): Promise<BetaFeedbackQueue> {
  const { data, error } = await supabase.rpc("get_beta_feedback_queue", {
    _status: status,
    _limit: 50,
    _offset: 0,
  });
  if (error) throw error;
  return data as unknown as BetaFeedbackQueue;
}

export async function updateBetaFeedbackStatus(
  id: string,
  status: FeedbackStatus,
  internalNote?: string | null,
) {
  const { error } = await supabase.rpc("update_beta_feedback_status", {
    _feedback_id: id,
    _status: status,
    _internal_note: internalNote ?? null,
  });
  if (error) throw error;
}

export interface BetaHealth {
  feedback_new: number;
  feedback_unresolved: number;
  feedback_total: number;
  error_events_24h: number;
  error_surfaces_24h: Record<string, number>;
  latest_app_version: string | null;
  open_place_reports: number;
  pending_place_suggestions: number;
  community_places_active: number;
  generated_at: string;
}

export async function fetchBetaHealth(): Promise<BetaHealth> {
  const { data, error } = await supabase.rpc("get_private_beta_health");
  if (error) throw error;
  return data as unknown as BetaHealth;
}

export interface OperationalFailureRow {
  fingerprint: string;
  event_name: string;
  error_category: string;
  surface: string;
  app_version: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
}

export async function fetchOperationalFailures(
  hours = 24,
): Promise<OperationalFailureRow[]> {
  const { data, error } = await supabase.rpc("get_beta_operational_failures", {
    _hours: hours,
    _limit: 50,
  });
  if (error) throw error;
  return (data as unknown as OperationalFailureRow[]) ?? [];
}

export type IntegrityHealth = Record<string, number | string>;

export async function fetchIntegrityHealth(): Promise<IntegrityHealth> {
  const { data, error } = await supabase.rpc(
    "get_private_beta_integrity_health",
  );
  if (error) throw error;
  return data as unknown as IntegrityHealth;
}
