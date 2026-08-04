import { supabase } from "@/integrations/supabase/client";

/**
 * WO-056 — Owner-only Community Place reverification and data freshness.
 *
 * Every call here is re-authorised server-side by is_owner(). Freshness is
 * derived from the existing verified_at / last_reverified_at dates — nothing
 * about review state is ever exposed to members, and reviewing a place never
 * changes what the public sees. Public consequences only happen when the owner
 * explicitly opts into the WO-053 maintenance action.
 */

export type ReverificationState =
  | "current"
  | "due_soon"
  | "due"
  | "never_reverified"
  | "under_review"
  | "needs_action";

export type FreshnessLabel = "current" | "due_soon" | "due" | "never_reverified";

export type ReverificationResult =
  | "confirmed_current"
  | "needs_place_update"
  | "needs_vegan_review"
  | "temporarily_closed"
  | "permanently_closed"
  | "duplicate_or_moved"
  | "insufficient_evidence";

export interface ReverificationQueueItem {
  id: string;
  name: string;
  neighborhood: string | null;
  category: string | null;
  maintenance_status: string;
  is_active: boolean;
  verification_status: string | null;
  veggie_classification: string | null;
  verified_at: string | null;
  last_reverified_at: string | null;
  has_google_place_id: boolean;
  reverification_state: ReverificationState;
  freshness: FreshnessLabel;
  open_review_id: string | null;
  open_review_started_at: string | null;
  needs_action_result: ReverificationResult | null;
  needs_action_at: string | null;
  open_reports_count: number;
}

export interface ReverificationPlace {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  neighborhood: string | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  website_url: string | null;
  business_status: string | null;
  is_active: boolean;
  maintenance_status: string;
  verification_status: string | null;
  veggie_classification: string | null;
  verified_at: string | null;
  last_reverified_at: string | null;
  freshness: FreshnessLabel;
}

export interface OpenReview {
  id: string;
  status: string;
  started_at: string;
}

export interface OpenReportSummary {
  id: string;
  reason_code: string;
  explanation: string;
  official_source_url: string | null;
  status: string;
  created_at: string;
}

export interface ReverificationHistoryEntry {
  id: string;
  status: string;
  result: ReverificationResult | null;
  started_at: string;
  completed_at: string | null;
  owner_note: string | null;
  official_source_url: string | null;
  google_status_observed: string | null;
  vegan_status_observed: string | null;
  details_status_observed: string | null;
  place_action_applied: boolean;
}

export interface ReverificationWorkspace {
  place: ReverificationPlace;
  open_review: OpenReview | null;
  open_reports: OpenReportSummary[];
  history: ReverificationHistoryEntry[];
}

/** Freshness/state labels. Never colour-only — the text always carries meaning. */
export const STATE_LABEL: Record<ReverificationState, string> = {
  current: "Current",
  due_soon: "Due soon",
  due: "Due",
  never_reverified: "Never reverified",
  under_review: "Under review",
  needs_action: "Needs action",
};

export const STATE_TONE: Record<ReverificationState, string> = {
  current: "bg-primary/10 text-primary",
  due_soon: "bg-amber-500/15 text-amber-700",
  due: "bg-destructive/10 text-destructive",
  never_reverified: "bg-muted text-muted-foreground",
  under_review: "bg-sky-500/15 text-sky-700",
  needs_action: "bg-destructive/10 text-destructive",
};

export const RESULT_LABEL: Record<ReverificationResult, string> = {
  confirmed_current: "Confirmed current",
  needs_place_update: "Needs place update",
  needs_vegan_review: "Needs vegan review",
  temporarily_closed: "Temporarily closed",
  permanently_closed: "Permanently closed",
  duplicate_or_moved: "Duplicate or moved",
  insufficient_evidence: "Insufficient evidence",
};

/** Plain-language consequence of each result, shown before the owner commits. */
export const RESULT_CONSEQUENCE: Record<ReverificationResult, string> = {
  confirmed_current:
    "Only the freshness date is refreshed. The original verification date, 100% Vegan classification, visibility and public details all stay exactly as they are. Members see no change.",
  needs_place_update:
    "The place is flagged for your attention. No public detail is edited automatically — apply the change yourself in Place status maintenance.",
  needs_vegan_review:
    "The place is flagged for your attention. The 100% Vegan badge is NOT removed and the place stays visible until you explicitly change it.",
  temporarily_closed:
    "Flagged for your attention. If you also apply the public status, the place is removed from discovery, search and the Host picker, check-ins are blocked, and returning it to operational will require Mark reverified.",
  permanently_closed:
    "Flagged for your attention. If you also apply the public status, the place is permanently hidden from discovery and search. The record is preserved — nothing is deleted — and member support already earned stays counted.",
  duplicate_or_moved:
    "Flagged for your attention. No records are merged and no new place is created automatically.",
  insufficient_evidence:
    "Flagged for your attention. The current public state is preserved until you explicitly change it.",
};

/** Results that may optionally apply a public WO-053 status action. */
export const CLOSURE_RESULTS: ReverificationResult[] = [
  "temporarily_closed",
  "permanently_closed",
];

export const GOOGLE_OBSERVED_OPTIONS = [
  { value: "matches", label: "Place ID resolves and name/address still match" },
  { value: "name_mismatch", label: "Name no longer reasonably matches" },
  { value: "address_mismatch", label: "Address no longer reasonably matches" },
  { value: "moved", label: "Moved to a clearly different location" },
  { value: "temporarily_closed", label: "Google reports temporarily closed" },
  { value: "permanently_closed", label: "Google reports permanently closed" },
  { value: "not_found", label: "Place ID no longer resolves" },
  { value: "unclear", label: "Unclear from Google" },
] as const;

export const VEGAN_OBSERVED_OPTIONS = [
  { value: "confirmed_fully_vegan", label: "Primary source confirms 100% vegan" },
  { value: "unclear", label: "Source is ambiguous" },
  { value: "not_fully_vegan", label: "Source shows non-vegan products" },
  { value: "no_source", label: "No usable primary source found" },
] as const;

export const DETAILS_OBSERVED_OPTIONS = [
  { value: "accurate", label: "Public details are accurate" },
  { value: "needs_update", label: "Public details need an update" },
  { value: "unclear", label: "Could not confirm public details" },
] as const;

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

export async function fetchReverificationQueue(): Promise<ReverificationQueueItem[]> {
  const { data, error } = await rpc("get_place_reverification_queue");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { places?: ReverificationQueueItem[] };
  return d.places ?? [];
}

export async function fetchReverificationWorkspace(
  placeId: string,
): Promise<ReverificationWorkspace> {
  const { data, error } = await rpc("get_place_reverification_workspace", {
    _place_id: placeId,
  });
  if (error) throw new Error(error.message);
  return data as ReverificationWorkspace;
}

export async function startReverification(placeId: string): Promise<{ duplicate: boolean }> {
  const { data, error } = await rpc("start_place_reverification", { _place_id: placeId });
  if (error) throw new Error(error.message);
  return { duplicate: (data as { duplicate?: boolean })?.duplicate === true };
}

export async function cancelReverification(placeId: string): Promise<void> {
  const { error } = await rpc("cancel_place_reverification", { _place_id: placeId });
  if (error) throw new Error(error.message);
}

export interface CompleteReverificationInput {
  placeId: string;
  result: ReverificationResult;
  ownerNote: string;
  officialSourceUrl: string | null;
  googleStatusObserved: string | null;
  veganStatusObserved: string | null;
  detailsStatusObserved: string | null;
  applyPlaceAction: boolean;
}

export async function completeReverification(
  input: CompleteReverificationInput,
): Promise<{ needs_action: boolean; place_action_applied: boolean }> {
  const { data, error } = await rpc("complete_place_reverification", {
    _place_id: input.placeId,
    _result: input.result,
    _owner_note: input.ownerNote,
    _official_source_url: input.officialSourceUrl,
    _google_status_observed: input.googleStatusObserved,
    _vegan_status_observed: input.veganStatusObserved,
    _details_status_observed: input.detailsStatusObserved,
    _apply_place_action: input.applyPlaceAction,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { needs_action?: boolean; place_action_applied?: boolean };
  return {
    needs_action: d.needs_action === true,
    place_action_applied: d.place_action_applied === true,
  };
}

/** Days since the freshness baseline, for owner-facing copy only. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
