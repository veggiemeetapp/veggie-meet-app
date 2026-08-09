import { supabase } from "@/integrations/supabase/client";

/**
 * WO-060 — Owner-only Community Place operations dashboard data layer.
 *
 * Two read-only owner RPCs back the whole dashboard:
 *   · get_community_place_operations_dashboard() — summary counts, place health,
 *     the de-duplicated attention queue and queue counts (one request)
 *   · get_community_place_activity(limit, before_at, before_id) — keyset-paginated
 *     owner-safe recent activity
 *
 * Both are SECURITY DEFINER, `is_owner()` gated, pinned search_path, revoked from
 * PUBLIC and anon, and cannot mutate anything. The dashboard performs no writes:
 * every action links into an existing specialised confirmation workflow.
 */

export type PlaceHealth =
  | "data_integrity"
  | "vegan_unconfirmed"
  | "permanently_closed"
  | "temporarily_closed"
  | "hidden"
  | "identity_review_in_progress"
  | "vegan_review_in_progress"
  | "reverification_needs_action"
  | "open_reports"
  | "reverification_in_progress"
  | "reverification_due"
  | "reverification_due_soon"
  | "healthy";

/** Health precedence, evaluated server-side in this exact order. */
export const HEALTH_PRECEDENCE: PlaceHealth[] = [
  "data_integrity",
  "vegan_unconfirmed",
  "permanently_closed",
  "temporarily_closed",
  "hidden",
  "identity_review_in_progress",
  "vegan_review_in_progress",
  "reverification_needs_action",
  "open_reports",
  "reverification_in_progress",
  "reverification_due",
  "reverification_due_soon",
  "healthy",
];

export const HEALTH_LABEL: Record<PlaceHealth, string> = {
  data_integrity: "Needs data fix",
  vegan_unconfirmed: "Vegan status unconfirmed",
  permanently_closed: "Permanently closed",
  temporarily_closed: "Temporarily closed",
  hidden: "Hidden",
  identity_review_in_progress: "Identity review in progress",
  vegan_review_in_progress: "Vegan review in progress",
  reverification_needs_action: "Reverification needs action",
  open_reports: "Open reports",
  reverification_in_progress: "Reverification in progress",
  reverification_due: "Reverification due",
  reverification_due_soon: "Reverification due soon",
  healthy: "Healthy",
};

/** Tone classes only ever accompany the text label — never colour-only. */
export const HEALTH_TONE: Record<PlaceHealth, string> = {
  data_integrity: "bg-destructive/10 text-destructive",
  vegan_unconfirmed: "bg-destructive/10 text-destructive",
  permanently_closed: "bg-destructive/10 text-destructive",
  temporarily_closed: "bg-amber-500/15 text-amber-700",
  hidden: "bg-muted text-muted-foreground",
  identity_review_in_progress: "bg-sky-500/15 text-sky-700",
  vegan_review_in_progress: "bg-sky-500/15 text-sky-700",
  reverification_needs_action: "bg-destructive/10 text-destructive",
  open_reports: "bg-amber-500/15 text-amber-700",
  reverification_in_progress: "bg-sky-500/15 text-sky-700",
  reverification_due: "bg-amber-500/15 text-amber-700",
  reverification_due_soon: "bg-amber-500/15 text-amber-700",
  healthy: "bg-soft-green text-primary",
};

export type AttentionType =
  | "data_integrity"
  | "vegan_unconfirmed"
  | "identity_review_open"
  | "vegan_review_open"
  | "open_report"
  | "reverification_needs_action"
  | "reverification_in_progress"
  | "reverification_due"
  | "reverification_due_soon"
  | "suggestion_pending"
  | "suggestion_under_review"
  | "hidden_operational"
  | "hidden"
  | "temporarily_closed";

export const ATTENTION_LABEL: Record<AttentionType, string> = {
  data_integrity: "Closed place still visible",
  vegan_unconfirmed: "No longer confirmed 100% vegan",
  identity_review_open: "Identity review in progress",
  vegan_review_open: "Vegan review in progress",
  open_report: "Open issue report",
  reverification_needs_action: "Reverification needs action",
  reverification_in_progress: "Reverification in progress",
  reverification_due: "Reverification due",
  reverification_due_soon: "Reverification due soon",
  suggestion_pending: "New community suggestion",
  suggestion_under_review: "Suggestion under review",
  hidden_operational: "Hidden but operational",
  hidden: "Hidden from discovery",
  temporarily_closed: "Temporarily closed",
};

export const ATTENTION_NEXT_ACTION: Record<AttentionType, string> = {
  data_integrity: "Review the place status so visibility matches the closure.",
  vegan_unconfirmed: "Reconfirm or restore the 100% vegan classification.",
  identity_review_open: "Finish or cancel the open identity review.",
  vegan_review_open: "Finish or cancel the open vegan review.",
  open_report: "Read the report and decide an outcome.",
  reverification_needs_action: "Apply the follow-up the last reverification asked for.",
  reverification_in_progress: "Continue the open reverification.",
  reverification_due: "Reverify this place against a primary source.",
  reverification_due_soon: "Plan a reverification soon.",
  suggestion_pending: "Review the suggestion and decide whether to verify it.",
  suggestion_under_review: "Finish reviewing this suggestion.",
  hidden_operational: "Confirm whether this place should be visible again.",
  hidden: "Confirm whether this place should be visible again.",
  temporarily_closed: "Confirm whether the place has reopened.",
};

export type Urgency = "blocker" | "high" | "medium" | "low";

export const URGENCY_LABEL: Record<Urgency, string> = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function urgencyOf(type: AttentionType): Urgency {
  switch (type) {
    case "data_integrity":
    case "vegan_unconfirmed":
      return "blocker";
    case "identity_review_open":
    case "vegan_review_open":
    case "open_report":
    case "reverification_needs_action":
      return "high";
    case "reverification_in_progress":
    case "reverification_due":
    case "suggestion_pending":
    case "suggestion_under_review":
      return "medium";
    default:
      return "low";
  }
}

export interface DashboardSummary {
  published_places: number;
  active_places: number;
  hidden_places: number;
  places_needing_attention: number;
  open_suggestions: number;
  open_reports: number;
  reverification_due: number;
  reverification_due_soon: number;
  reviews_in_progress: number;
  candidates_total: number;
  attention_items: number;
}

export interface PlaceHealthRow {
  id: string;
  name: string;
  neighborhood: string | null;
  category: string | null;
  is_active: boolean;
  maintenance_status: string;
  veggie_classification: string | null;
  verification_status: string | null;
  freshness: string;
  verified_at: string | null;
  last_reverified_at: string | null;
  has_google_place_id: boolean;
  open_reports_count: number;
  open_reviews_count: number;
  open_reverification: boolean;
  open_vegan_review: boolean;
  open_identity_review: boolean;
  reverification_needs_action: boolean;
  last_reverification_result: string | null;
  supported_count: number;
  upcoming_meetups_here: number;
  hosting_eligible: boolean;
  check_in_eligible: boolean;
  health: PlaceHealth;
}

export interface AttentionItem {
  entity_id: string;
  entity_kind: "place" | "suggestion";
  title: string;
  subtitle: string | null;
  item_type: AttentionType;
  occurred_at: string | null;
  rank: number;
  secondary_types: Array<{ type: AttentionType }>;
  open_reports_count: number;
}

export interface QueueCounts {
  suggestions: Record<string, number>;
  reports: Record<string, number>;
  reverifications: Record<string, number>;
  vegan_reviews: Record<string, number>;
  identity_reviews: Record<string, number>;
  candidates: Record<string, number>;
}

export interface OperationsDashboard {
  summary: DashboardSummary;
  places: PlaceHealthRow[];
  attention: AttentionItem[];
  queues: QueueCounts;
  generated_at: string;
}

export type ActivityKind =
  | "place_activated"
  | "place_deactivated"
  | "operational_status_changed"
  | "public_details_updated"
  | "place_reverified"
  | "vegan_status_reviewed"
  | "vegan_classification_changed"
  | "identity_replaced"
  | "branch_relocated"
  | "suggestion_moderated"
  | "report_resolved"
  | "candidate_published";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  place_activated: "Place made visible",
  place_deactivated: "Place hidden",
  operational_status_changed: "Operational status changed",
  public_details_updated: "Public details updated",
  place_reverified: "Place reverified",
  vegan_status_reviewed: "Vegan status reviewed",
  vegan_classification_changed: "Vegan classification changed",
  identity_replaced: "Google identity replaced",
  branch_relocated: "Branch relocated",
  suggestion_moderated: "Community suggestion reviewed",
  report_resolved: "Issue report closed",
  candidate_published: "Place published",
};

export interface ActivityItem {
  id: string;
  occurred_at: string;
  kind: ActivityKind;
  source: string;
  place_id: string | null;
  place_name: string | null;
  /** Owner-safe summary token — never a note, evidence URL or coordinate. */
  detail_a: string | null;
  detail_b: string | null;
  detail_c: string | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  has_more: boolean;
}

/** Bound wrapper — `supabase.rpc` loses its `this` binding when detached. */
const rpc = (
  name: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> =>
  (supabase.rpc as unknown as (
    n: string,
    a?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>).call(
    supabase,
    name,
    args,
  );

export async function fetchOperationsDashboard(): Promise<OperationsDashboard> {
  const { data, error } = await rpc("get_community_place_operations_dashboard");
  if (error) throw new Error(error.message);
  return data as OperationsDashboard;
}

export async function fetchActivityPage(cursor?: {
  before_at: string;
  before_id: string;
}): Promise<ActivityPage> {
  const { data, error } = await rpc("get_community_place_activity", {
    _limit: 20,
    _before_at: cursor?.before_at ?? null,
    _before_id: cursor?.before_id ?? null,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<ActivityPage>;
  return { items: d.items ?? [], has_more: d.has_more === true };
}

export const FRESHNESS_LABEL: Record<string, string> = {
  current: "Current",
  due_soon: "Due soon",
  due: "Due",
  never_reverified: "Never reverified",
};

export const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

export const MAINT_LABEL: Record<string, string> = {
  operational: "Operational",
  needs_reverification: "Needs reverification",
  temporarily_closed: "Temporarily closed",
  permanently_closed: "Permanently closed",
};

export const VEGAN_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  not_confirmed_fully_vegan: "Not confirmed fully vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian friendly",
  vegan_options: "Vegan options",
  not_food: "Community space",
};

export function humanLabel(map: Record<string, string>, raw: string | null | undefined): string {
  if (!raw) return "—";
  return map[raw] ?? raw.replace(/_/g, " ");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Deep link into the correct specialised owner workflow for an attention type. */
export function attentionLink(item: {
  entity_kind: string;
  entity_id: string;
  item_type: AttentionType;
}): { label: string; to?: string; tab?: string } {
  if (item.entity_kind === "suggestion") {
    return { label: "Review suggestion", tab: "suggestions" };
  }
  switch (item.item_type) {
    case "identity_review_open":
      return { label: "Review place identity", to: `/owner/places/${item.entity_id}/identity-review` };
    case "vegan_unconfirmed":
    case "vegan_review_open":
      return { label: "Review vegan status", to: `/owner/places/${item.entity_id}/vegan-review` };
    case "reverification_needs_action":
    case "reverification_in_progress":
    case "reverification_due":
    case "reverification_due_soon":
      return { label: "Continue reverification", to: `/owner/places/${item.entity_id}/reverify` };
    case "open_report":
      return { label: "Review report", tab: "reports" };
    default:
      return { label: "Open maintenance", tab: "maintenance" };
  }
}
