import { supabase } from "@/integrations/supabase/client";

/** Supabase types are regenerated post-migration; cast rpc to keep TS green. */
type RpcFn = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as RpcFn)<T>(name, args);

export type SuggestionStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "rejected"
  | "duplicate";

/** Safe reason codes returned by submit_community_place_suggestion(). */
export type SubmitReason =
  | "success"
  | "invalid_input"
  | "invalid_url"
  | "duplicate_suggestion"
  | "submission_limit_reached"
  | "unsupported_city"
  | "unauthenticated";

export interface SubmitResult {
  ok: boolean;
  reason: SubmitReason;
  suggestion_id?: string;
}

export interface MySuggestion {
  id: string;
  place_name: string;
  city_name: string | null;
  submitted_at: string;
  status: SuggestionStatus;
}

export interface OwnerSuggestion {
  id: string;
  place_name: string;
  address_text: string;
  official_source_url: string;
  vegan_reason: string;
  submitter_note: string | null;
  city_name: string | null;
  city_id: string | null;
  submitted_at: string;
  moderation_status: SuggestionStatus;
  rejection_reason: string | null;
  promoted_candidate_id: string | null;
  submitter_profile_id: string;
  possible_duplicate: boolean;
}

/** User-facing status wording. Never exposes internal moderation detail. */
export const USER_STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: "Pending review",
  under_review: "Under review",
  approved: "Approved for verification",
  rejected: "Not approved",
  duplicate: "Already suggested",
};

/** Short, non-internal explanation shown under a suggestion's status. */
export const USER_STATUS_HINT: Record<SuggestionStatus, string> = {
  pending: "We'll review your suggestion soon.",
  under_review: "The VeggieMeet team is reviewing this place.",
  approved: "We're checking the place before it can appear publicly.",
  rejected: "This place doesn't currently meet the requirements for Community Places.",
  duplicate: "This place is already in our review process.",
};


export const REJECTION_REASONS = [
  { value: "not_fully_vegan", label: "Not fully vegan" },
  { value: "insufficient_evidence", label: "Insufficient evidence" },
  { value: "closed_or_unavailable", label: "Closed or unavailable" },
  { value: "incorrect_information", label: "Incorrect information" },
  { value: "outside_supported_city", label: "Outside supported city" },
  { value: "other", label: "Other" },
] as const;

export async function submitPlaceSuggestion(input: {
  cityId: string;
  placeName: string;
  addressText: string;
  officialSourceUrl: string;
  veganReason: string;
  submitterNote?: string;
}): Promise<SubmitResult> {
  const { data, error } = await rpc<SubmitResult>("submit_community_place_suggestion", {
    _city_id: input.cityId,
    _place_name: input.placeName,
    _address_text: input.addressText,
    _official_source_url: input.officialSourceUrl,
    _vegan_reason: input.veganReason,
    _submitter_note: input.submitterNote?.trim() ? input.submitterNote : null,
  });
  if (error) throw new Error(error.message);
  return (data as SubmitResult) ?? { ok: false, reason: "invalid_input" };
}

export async function fetchMyPlaceSuggestions(): Promise<MySuggestion[]> {
  const { data, error } = await rpc<MySuggestion[]>("get_my_place_suggestions");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchSuggestionQueue(): Promise<OwnerSuggestion[]> {
  const { data, error } = await rpc<OwnerSuggestion[]>("get_place_suggestion_queue");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function moderateSuggestion(
  id: string,
  action: "start_review" | "reject" | "duplicate",
  reason?: string,
  notes?: string,
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await rpc<{ ok: boolean; reason: string }>(
    "moderate_place_suggestion",
    { _suggestion_id: id, _action: action, _reason: reason ?? null, _notes: notes ?? null },
  );
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "unknown" };
}

export async function promoteSuggestion(
  id: string,
): Promise<{ ok: boolean; reason: string; candidate_id?: string }> {
  const { data, error } = await rpc<{ ok: boolean; reason: string; candidate_id?: string }>(
    "promote_place_suggestion_to_candidate",
    { _suggestion_id: id },
  );
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "unknown" };
}
