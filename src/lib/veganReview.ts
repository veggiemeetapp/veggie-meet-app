import { supabase } from "@/integrations/supabase/client";

/**
 * WO-058 — Owner-only Community Place vegan verification status changes.
 *
 * Every call here is re-authorised server-side by is_owner(). Starting a review
 * never changes the public place. The 100% Vegan classification is only ever
 * removed through an explicitly confirmed completion, and removal always hides
 * the place from Community Places discovery in the same transaction. Nothing is
 * deleted, no duplicate place is created, Google identity is untouched, and the
 * operational (open/closed) status stays a separate WO-053 decision.
 */

export type VeganReviewResult =
  | "confirmed_fully_vegan"
  | "insufficient_evidence"
  | "no_longer_fully_vegan";

export type EvidenceConfidence =
  | "confirms_fully_vegan"
  | "ambiguous"
  | "shows_non_vegan"
  | "no_source";

export type VeganPublicAction =
  | "none"
  | "deactivate"
  | "revoke_and_deactivate"
  | "restore_and_reactivate";

export const VEGAN_CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian friendly",
  vegan_options: "Vegan options",
  not_food: "Community space",
  not_confirmed_fully_vegan: "No longer confirmed fully vegan",
};

/** A. Official source. */
export const SOURCE_CHECKS = [
  { id: "source_reachable", label: "The official source is reachable right now" },
  { id: "source_belongs_to_business", label: "The source belongs to this business" },
  { id: "source_current", label: "The source is current enough to rely on" },
  { id: "source_states_fully_vegan", label: "The source explicitly supports 100% vegan status" },
] as const;

/** B. Menu and products. */
export const PRODUCT_CHECKS = [
  { id: "no_meat", label: "No meat products shown" },
  { id: "no_fish", label: "No fish or seafood shown" },
  { id: "no_dairy", label: "No dairy products shown" },
  { id: "no_egg", label: "No egg products shown" },
  { id: "no_other_non_vegan", label: "No honey or other non-vegan products shown" },
  { id: "no_mixed_menu", label: "No mixed vegan and non-vegan menu shown" },
] as const;

/** C. Business identity. */
export const IDENTITY_CHECKS = [
  { id: "same_business", label: "The evidence refers to the same business" },
  { id: "same_branch", label: "The evidence refers to this branch or location" },
  { id: "name_address_match", label: "Name and address reasonably match" },
  { id: "not_different_business", label: "The source does not refer to a different business" },
] as const;

/** D. Evidence confidence. */
export const CONFIDENCE_OPTIONS: Array<{ value: EvidenceConfidence; label: string }> = [
  { value: "confirms_fully_vegan", label: "Primary source confirms 100% vegan" },
  { value: "ambiguous", label: "Evidence is incomplete or ambiguous" },
  { value: "shows_non_vegan", label: "Primary source shows non-vegan products" },
  { value: "no_source", label: "No current primary source found" },
];

export const RESULT_LABEL: Record<VeganReviewResult, string> = {
  confirmed_fully_vegan: "Confirmed fully vegan",
  insufficient_evidence: "Insufficient evidence",
  no_longer_fully_vegan: "No longer fully vegan",
};

export const RESULT_CONSEQUENCE: Record<VeganReviewResult, string> = {
  confirmed_fully_vegan:
    "The 100% Vegan classification stays exactly as it is and the place remains visible. Only the freshness date advances — the original verification date, Google identity, visibility and operational status are all preserved. Members see no change.",
  insufficient_evidence:
    "This is not proof that the business serves non-vegan products, so the classification is never changed automatically. You choose whether to keep investigating with no public change, or to temporarily hide the place from discovery through the existing visibility workflow.",
  no_longer_fully_vegan:
    "The 100% Vegan classification is removed and the place is hidden from Community Places discovery in one step. The record, its Google Place ID, its operational status, and every past visit, Meetup and support count are preserved. Nothing is deleted and the business is not marked closed.",
};

/**
 * WO-058A — consequence copy shown instead of the normal "confirmed" copy when
 * the place currently carries a revoked classification. Confirming restores the
 * 100% Vegan classification; returning it to discovery is a separate, explicitly
 * confirmed choice.
 */
export const RESTORE_RESULT_CONSEQUENCE =
  "This place’s 100% Vegan status was previously removed. A fully-evidenced confirmation restores the 100% Vegan classification and advances the freshness date. Returning it to Community Places discovery is a separate choice you confirm below — nothing is duplicated, no history is deleted, and the Google identity and operational status are untouched.";

/** Acceptable primary evidence, and what can only trigger a review. */
export const ACCEPTABLE_EVIDENCE = [
  "Official website",
  "Official menu",
  "Official social-media account",
  "A direct official statement from the business",
];

export const INSUFFICIENT_EVIDENCE_SOURCES = [
  "Google reviews",
  "Other third-party reviews",
  "HappyCow or other aggregators",
  "Member comments",
  "Screenshots with no verifiable official source",
  "Assumptions based on the business name",
  "Clearly outdated past verification evidence",
];

export interface VeganReviewPlace {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  category: string | null;
  is_active: boolean;
  maintenance_status: string;
  verification_status: string | null;
  veggie_classification: string | null;
  veggie_reason: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  verified_at: string | null;
  last_reverified_at: string | null;
  has_google_place_id: boolean;
  freshness: string;
}

export interface OpenVeganReview {
  id: string;
  status: string;
  started_at: string;
}

export interface VeganReportSummary {
  id: string;
  reason_code: string;
  explanation: string;
  official_source_url: string | null;
  additional_details?: string | null;
  status: string;
  created_at: string;
}

export interface VeganReviewHistoryEntry {
  id: string;
  status: string;
  result: string | null;
  started_at: string;
  completed_at: string | null;
  evidence_source_url: string | null;
  evidence_summary: string | null;
  owner_note: string | null;
  evidence_confidence: string | null;
  prior_classification: string | null;
  resulting_classification: string | null;
  public_action: string | null;
  public_action_applied: boolean;
  related_report_id: string | null;
  related_reverification_id: string | null;
}

export interface VeganClassificationHistoryEntry {
  id: string;
  old_classification: string | null;
  new_classification: string;
  action: string;
  internal_reason: string | null;
  changed_at: string;
  vegan_review_id: string | null;
}

export interface RelatedReverification {
  id: string;
  result: string | null;
  status: string;
  completed_at: string | null;
  owner_note: string | null;
  official_source_url: string | null;
  vegan_status_observed: string | null;
}

export interface VeganReviewWorkspace {
  place: VeganReviewPlace;
  open_review: OpenVeganReview | null;
  open_vegan_reports: VeganReportSummary[];
  history: VeganReviewHistoryEntry[];
  classification_history: VeganClassificationHistoryEntry[];
  related_report: VeganReportSummary | null;
  related_reverification: RelatedReverification | null;
}

/** Owner-facing wording for every server-side block reason. No raw SQL errors. */
export const BLOCK_REASON_MESSAGE: Record<string, string> = {
  owner_only: "This area is limited to the VeggieMeet owner.",
  place_not_published: "This place is not a published Community Place.",
  no_open_review: "Start a vegan review before completing one.",
  invalid_result: "Choose one review result.",
  invalid_evidence_confidence: "Select what the evidence actually showed.",
  invalid_source_checks: "Unrecognised official-source observation.",
  invalid_product_checks: "Unrecognised menu or product observation.",
  invalid_identity_checks: "Unrecognised business-identity observation.",
  invalid_evidence_summary: "Write an evidence summary between 20 and 1,000 characters.",
  invalid_owner_note: "An internal owner note is required (500 characters or fewer).",
  invalid_evidence_url: "Enter a valid http(s) evidence link.",
  evidence_url_required: "This result requires a primary-source evidence link.",
  contradictory_confidence:
    "The result contradicts what you recorded as the observed evidence.",
  contradictory_product_checks:
    "The menu and product observations contradict the result you selected.",
  identity_not_established:
    "Confirm the evidence belongs to this business and this branch before completing.",
  invalid_public_action: "That public action is not valid for this result.",
  place_not_operational:
    "Restore the operational status first — a closed or reverification-pending place cannot return to discovery here.",
  confirmation_required: "Confirm the public consequence before completing.",
  invalid_related_report: "The linked member report does not match this place.",
  invalid_related_reverification: "The linked reverification does not match this place.",
};

export function blockMessage(reason: string | undefined): string {
  if (!reason) return "This review could not be completed.";
  return BLOCK_REASON_MESSAGE[reason] ?? "This review could not be completed.";
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

export async function fetchVeganReviewWorkspace(
  placeId: string,
  reportId?: string | null,
  reverificationId?: string | null,
): Promise<VeganReviewWorkspace> {
  const { data, error } = await rpc("get_community_place_vegan_review_workspace", {
    _place_id: placeId,
    _report_id: reportId ?? null,
    _reverification_id: reverificationId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as VeganReviewWorkspace;
}

export async function startVeganReview(
  placeId: string,
): Promise<{ ok: boolean; duplicate: boolean; reason?: string }> {
  const { data, error } = await rpc("start_community_place_vegan_review", {
    _place_id: placeId,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { ok?: boolean; duplicate?: boolean; reason?: string };
  return { ok: d.ok === true, duplicate: d.duplicate === true, reason: d.reason };
}

export async function cancelVeganReview(placeId: string): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await rpc("cancel_community_place_vegan_review", {
    _place_id: placeId,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: d.ok === true, reason: d.reason };
}

export interface CompleteVeganReviewInput {
  placeId: string;
  result: VeganReviewResult;
  evidenceSummary: string;
  ownerNote: string;
  evidenceConfidence: EvidenceConfidence;
  sourceChecks: string[];
  productChecks: string[];
  identityChecks: string[];
  evidenceSourceUrl: string | null;
  publicAction: VeganPublicAction;
  confirmPublicAction: boolean;
  relatedReportId: string | null;
  relatedReverificationId: string | null;
}

export interface CompleteVeganReviewOutcome {
  ok: boolean;
  reason?: string;
  result?: VeganReviewResult;
  public_action?: VeganPublicAction;
  public_action_applied?: boolean;
  classification?: string;
  freshness_updated?: boolean;
  needs_action?: boolean;
}

export async function completeVeganReview(
  input: CompleteVeganReviewInput,
): Promise<CompleteVeganReviewOutcome> {
  const { data, error } = await rpc("complete_community_place_vegan_review", {
    _place_id: input.placeId,
    _result: input.result,
    _evidence_summary: input.evidenceSummary,
    _owner_note: input.ownerNote,
    _evidence_confidence: input.evidenceConfidence,
    _source_checks: input.sourceChecks,
    _product_checks: input.productChecks,
    _identity_checks: input.identityChecks,
    _evidence_source_url: input.evidenceSourceUrl,
    _public_action: input.publicAction,
    _confirm_public_action: input.confirmPublicAction,
    _related_report_id: input.relatedReportId,
    _related_reverification_id: input.relatedReverificationId,
  });
  if (error) throw new Error(error.message);
  return (data ?? { ok: false }) as CompleteVeganReviewOutcome;
}

/** Client-side mirror of the server evidence URL rule. */
export function veganEvidenceUrlError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return "Only http:// or https:// links are accepted.";
  if (/[\s]/.test(v)) return "Enter a valid link with no spaces.";
  if (/^https?:\/\/[^/@]*@/i.test(v)) return "Links with embedded credentials are not accepted.";
  if (!/^https?:\/\/[^\s/]+\.[^\s/]{2,}/i.test(v)) return "Enter a valid http(s) link.";
  return null;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
