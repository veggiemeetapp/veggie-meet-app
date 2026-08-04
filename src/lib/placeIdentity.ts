import { supabase } from "@/integrations/supabase/client";

/**
 * WO-059 — Owner-only Community Place identity replacement and location moves.
 *
 * Every call is re-authorised server-side by is_owner(). Starting a review never
 * changes the public place. A published place can only ever have its Google
 * identity or location corrected when the evidence shows it is the SAME business
 * and the SAME branch. A different branch or a different business can never take
 * over an existing record — those outcomes create a private draft candidate that
 * must pass its own verification. Vegan classification, operational status,
 * visibility, the original verification date and all member history are never
 * touched here, and nothing is ever deleted or duplicated.
 */

export type IdentityCaseType =
  | "same_business_same_branch"
  | "same_business_branch_moved"
  | "different_branch"
  | "different_business_or_unclear";

export type IdentityResult =
  | "identity_replaced"
  | "location_moved"
  | "new_branch_required"
  | "different_business"
  | "insufficient_evidence";

export const CASE_TYPE_LABEL: Record<IdentityCaseType, string> = {
  same_business_same_branch: "Same business, same branch — Google listing replaced",
  same_business_branch_moved: "Same business, same branch — it moved to a new address",
  different_branch: "A different branch of the same business",
  different_business_or_unclear: "A different business, or the evidence is unclear",
};

export const CASE_TYPES: Array<{ value: IdentityCaseType; label: string; hint: string }> = [
  {
    value: "same_business_same_branch",
    label: CASE_TYPE_LABEL.same_business_same_branch,
    hint: "The same venue at the same address now has a new or corrected Google listing.",
  },
  {
    value: "same_business_branch_moved",
    label: CASE_TYPE_LABEL.same_business_branch_moved,
    hint: "The same venue relocated. Its address and coordinates changed.",
  },
  {
    value: "different_branch",
    label: CASE_TYPE_LABEL.different_branch,
    hint: "This is a separate location of the same business — it needs its own record.",
  },
  {
    value: "different_business_or_unclear",
    label: CASE_TYPE_LABEL.different_business_or_unclear,
    hint: "The evidence points somewhere else, or you cannot prove it is the same place.",
  },
];

export const RESULT_LABEL: Record<IdentityResult, string> = {
  identity_replaced: "Replace the Google identity",
  location_moved: "Record a branch relocation",
  new_branch_required: "Needs a separate new branch record",
  different_business: "Different business — no change",
  insufficient_evidence: "Insufficient evidence — no change",
};

export const RESULT_CONSEQUENCE: Record<IdentityResult, string> = {
  identity_replaced:
    "The same place record keeps its vegan classification, operational status, visibility, original verification date and every past visit, Meetup and support count. Only the Google identity — and the details you explicitly select — are updated. Nothing is duplicated and no history moves to another place.",
  location_moved:
    "The same place record is kept and its address, area and coordinates are updated together with the Google identity you selected. Existing Meetups are never cancelled or moved; hosts stay responsible for their own Meetup locations. Vegan classification, visibility and member history are untouched.",
  new_branch_required:
    "This published place is left completely unchanged. A separate private draft is created for the new branch, which must pass its own Google verification and 100% vegan review before it can ever be published.",
  different_business:
    "Nothing about this published place changes. The review is recorded privately so the decision and its evidence are auditable.",
  insufficient_evidence:
    "Nothing about this published place changes. The review is recorded privately so the missing evidence is auditable and the question can be reopened later.",
};

/** Which results a case type may legitimately produce (mirrors the server matrix). */
export const ALLOWED_RESULTS: Record<IdentityCaseType, IdentityResult[]> = {
  same_business_same_branch: ["identity_replaced", "insufficient_evidence"],
  same_business_branch_moved: ["location_moved", "insufficient_evidence"],
  different_branch: ["new_branch_required", "insufficient_evidence"],
  different_business_or_unclear: ["different_business", "insufficient_evidence"],
};


export const ACCEPTABLE_EVIDENCE = [
  "The Google listing itself (name, address, coordinates, map link)",
  "Official website or official menu",
  "Official social-media account of the business",
  "A direct official statement from the business",
];

export const INSUFFICIENT_EVIDENCE_SOURCES = [
  "Google reviews or other third-party reviews",
  "Aggregators such as HappyCow",
  "Member comments alone",
  "A similar name or a nearby pin",
  "Screenshots with no verifiable official source",
];

export const IDENTITY_CONFIRMATIONS = [
  {
    id: "same_business_confirmed",
    label: "The evidence refers to the same business, not a similarly named one",
  },
  {
    id: "same_branch_confirmed",
    label: "The evidence refers to this same branch, not another location",
  },
  {
    id: "relocation_confirmed",
    label: "The business itself moved — this is not a second location",
  },
] as const;

export interface IdentityPlace {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  website_url: string | null;
  business_status: string | null;
  is_active: boolean;
  maintenance_status: string;
  verification_status: string;
  veggie_classification: string | null;
  verified_at: string | null;
  last_reverified_at: string | null;
  freshness: string | null;
}

export interface IdentityReviewRecord {
  id: string;
  status: string;
  case_type: string | null;
  result: string | null;
  started_at: string;
  completed_at: string | null;
  old_google_place_id: string | null;
  proposed_google_place_id: string | null;
  old_name: string | null;
  proposed_name: string | null;
  old_address: string | null;
  proposed_address: string | null;
  proposed_latitude: number | null;
  proposed_longitude: number | null;
  official_source_url: string | null;
  evidence_summary: string | null;
  owner_note: string | null;
  distance_meters: number | null;
  public_action_applied: boolean;
  created_candidate_id: string | null;
}

export interface IdentityHistoryRecord {
  id: string;
  action: string;
  old_google_place_id: string | null;
  new_google_place_id: string | null;
  old_address: string | null;
  new_address: string | null;
  old_latitude: number | null;
  old_longitude: number | null;
  new_latitude: number | null;
  new_longitude: number | null;
  changed_at: string;
  internal_reason: string | null;
}

export interface IdentityRelatedReport {
  id: string;
  reason_code: string;
  explanation: string | null;
  official_source_url: string | null;
  status: string;
  created_at: string;
}

export interface IdentityReviewWorkspace {
  place: IdentityPlace;
  open_review: IdentityReviewRecord | null;
  history: IdentityReviewRecord[];
  identity_history: IdentityHistoryRecord[];
  open_identity_reports: IdentityRelatedReport[];
  related_report: IdentityRelatedReport | null;
  related_reverification: {
    id: string;
    status: string;
    result: string | null;
    completed_at: string | null;
    owner_note: string | null;
    official_source_url: string | null;
    google_status_observed: string | null;
  } | null;
}

export interface IdentityActionResult {
  ok: boolean;
  reason?: string;
  conflict?: string;
  duplicate?: boolean;
  review_id?: string;
  result?: string;
  public_action_applied?: boolean;
  no_op?: boolean;
  distance_meters?: number | null;
  changed_fields?: string[];
  candidate_id?: string | null;
}

// Supabase types are regenerated after migration approval; casting keeps this
// compile-safe. Never destructure supabase.rpc — it loses its `this` binding.
type RpcFn = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      n: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: T | null; error: { message: string } | null }>
  ).call(supabase, name, args);

export async function fetchIdentityReviewWorkspace(
  placeId: string,
  reportId?: string | null,
  reverificationId?: string | null,
): Promise<IdentityReviewWorkspace> {
  const { data, error } = await rpc<IdentityReviewWorkspace>(
    "get_community_place_identity_review_workspace",
    {
      _place_id: placeId,
      _report_id: reportId ?? null,
      _reverification_id: reverificationId ?? null,
    },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Identity review workspace unavailable.");
  return data;
}

export async function startIdentityReview(placeId: string): Promise<IdentityActionResult> {
  const { data, error } = await rpc<IdentityActionResult>(
    "start_community_place_identity_review",
    { _place_id: placeId },
  );
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "unknown" };
}

export async function cancelIdentityReview(placeId: string): Promise<IdentityActionResult> {
  const { data, error } = await rpc<IdentityActionResult>(
    "cancel_community_place_identity_review",
    { _place_id: placeId },
  );
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "unknown" };
}

export interface CompleteIdentityReviewInput {
  placeId: string;
  caseType: IdentityCaseType;
  result: IdentityResult;
  proposedGooglePlaceId: string | null;
  proposedName: string | null;
  proposedAddress: string | null;
  proposedNeighborhood: string | null;
  proposedLatitude: number | null;
  proposedLongitude: number | null;
  proposedMapsUrl: string | null;
  proposedWebsiteUrl: string | null;
  officialSourceUrl: string | null;
  evidenceSummary: string;
  ownerNote: string;
  sameBusinessConfirmed: boolean;
  sameBranchConfirmed: boolean;
  relocationConfirmed: boolean;
  applyGoogleIdentity: boolean;
  applyName: boolean;
  applyLocation: boolean;
  applyWebsite: boolean;
  confirmPublicAction: boolean;
  acknowledgeLargeMove: boolean;
  createCandidate: boolean;
  relatedReportId?: string | null;
  relatedReverificationId?: string | null;
}

export async function completeIdentityReview(
  input: CompleteIdentityReviewInput,
): Promise<IdentityActionResult> {
  const { data, error } = await rpc<IdentityActionResult>(
    "complete_community_place_identity_review",
    {
      _place_id: input.placeId,
      _case_type: input.caseType,
      _result: input.result,
      _proposed_google_place_id: input.proposedGooglePlaceId,
      _proposed_name: input.proposedName,
      _proposed_address: input.proposedAddress,
      _proposed_neighborhood: input.proposedNeighborhood,
      _proposed_latitude: input.proposedLatitude,
      _proposed_longitude: input.proposedLongitude,
      _proposed_maps_url: input.proposedMapsUrl,
      _proposed_website_url: input.proposedWebsiteUrl,
      _official_source_url: input.officialSourceUrl,
      _evidence_summary: input.evidenceSummary,
      _owner_note: input.ownerNote,
      _same_business_confirmed: input.sameBusinessConfirmed,
      _same_branch_confirmed: input.sameBranchConfirmed,
      _relocation_confirmed: input.relocationConfirmed,
      _apply_google_identity: input.applyGoogleIdentity,
      _apply_name: input.applyName,
      _apply_location: input.applyLocation,
      _apply_website: input.applyWebsite,
      _confirm_public_action: input.confirmPublicAction,
      _acknowledge_large_move: input.acknowledgeLargeMove,
      _create_candidate: input.createCandidate,
      _related_report_id: input.relatedReportId ?? null,
      _related_reverification_id: input.relatedReverificationId ?? null,
    },
  );
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "unknown" };
}

/** Member-safe, plain-language refusal copy. Internal reasons are never shown raw. */
export function identityBlockMessage(reason?: string, conflict?: string): string {
  switch (reason) {
    case "place_not_published":
      return "That place isn't a published Community Place, so it can't have an identity review.";
    case "no_open_review":
      return "There is no open identity review for this place. Start one before recording a result.";
    case "invalid_case_type":
    case "invalid_result":
      return "Choose what the evidence shows and the matching result before recording the review.";
    case "contradictory_case_result":
      return "That result contradicts the case you selected. A different branch or a different business can never replace this place.";
    case "same_business_not_confirmed":
      return "Confirm the evidence refers to the same business before changing its identity.";
    case "same_branch_not_confirmed":
      return "Confirm the evidence refers to this same branch. A different branch needs its own record.";
    case "relocation_not_confirmed":
      return "Confirm the business itself moved before recording a relocation.";
    case "invalid_owner_note":
      return "An internal owner note is required, up to 500 characters.";
    case "invalid_evidence_summary":
      return "Describe the evidence in 20 to 1,000 characters.";
    case "invalid_evidence_url":
      return "That evidence link isn't a valid web address.";
    case "evidence_url_required":
      return "This result requires a primary-source evidence link.";
    case "invalid_google_place_id":
      return "That Google Place ID doesn't look valid.";
    case "google_place_id_required":
      return "A verified Google Place ID is required for this result.";
    case "duplicate_google_place_id":
      return conflict === "published_place"
        ? "Another published Community Place already uses that Google listing. Two places can never share one Google identity."
        : conflict === "candidate"
          ? "A private place draft already uses that Google listing. Resolve that draft first."
          : "Another open identity review already proposes that Google listing.";
    case "proposed_location_required":
      return "A relocation needs the new address and its coordinates.";
    case "large_move_not_acknowledged":
      return "This is a large move. Confirm you understand the distance before applying it.";
    case "confirmation_required":
      return "Confirm the public change before it can be applied.";
    case "invalid_related_report":
    case "invalid_related_reverification":
      return "That linked record doesn't belong to this place.";
    case "invalid_proposed_website":
      return "That website link isn't a valid web address.";
    case "invalid_proposed_maps_url":
      return "That Google Maps link isn't a valid web address.";
    default:
      return "That identity review action couldn't be completed.";
  }
}

export function identityUrlError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return "Links must start with http:// or https://";
  if (v.includes("@")) return "Links can't contain an email address.";
  if (v.length > 500) return "Keep links to 500 characters or fewer.";
  return null;
}

export function googlePlaceIdError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(v))
    return "A Google Place ID uses letters, numbers, hyphens and underscores only.";
  return null;
}

/** Haversine metres — display-only. The server recomputes and enforces limits. */
export function distanceMeters(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
): number | null {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const r = (d: number) => (d * Math.PI) / 180;
  return (
    2 *
    6371000 *
    Math.asin(
      Math.sqrt(
        Math.sin(r(lat2 - lat1) / 2) ** 2 +
          Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2,
      ),
    )
  );
}

export function formatDistance(m: number | null): string {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function formatIdentityDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  return new Date(raw).toLocaleString();
}

export const IDENTITY_ACTION_LABEL: Record<string, string> = {
  google_identity_replaced: "Google identity replaced",
  branch_relocated: "Branch relocated",
  identity_review_rejected: "Identity change rejected",
};

export const IDENTITY_RESULT_LABEL: Record<string, string> = {
  ...RESULT_LABEL,
  no_change: "No change applied",
  cancelled: "Cancelled",
};
