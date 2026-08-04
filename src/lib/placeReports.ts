import { supabase } from "@/integrations/supabase/client";

/**
 * WO-054 — Report a Community Place Issue.
 *
 * A report is a private moderation signal. Submitting one never changes the
 * public place record; only an owner action (WO-053 maintenance RPCs, invoked
 * server-side by moderate_community_place_report) can do that. Members never
 * receive owner notes, reviewer identity, or other members' reports.
 */

/** Supabase types are regenerated post-migration; cast rpc to keep TS green. */
type RpcFn = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as RpcFn)<T>(name, args);

export type PlaceReportStatus =
  | "pending"
  | "under_review"
  | "resolved"
  | "dismissed"
  | "duplicate";

export type PlaceReportReason =
  | "permanently_closed"
  | "temporarily_closed"
  | "vegan_status_concern"
  | "incorrect_name"
  | "incorrect_location"
  | "incorrect_source"
  | "duplicate_place"
  | "other";

export type ReportSubmitReason =
  | "report_submitted"
  | "invalid_input"
  | "invalid_url"
  | "invalid_reason"
  | "duplicate_report"
  | "report_limit_reached"
  | "place_not_found"
  | "unauthenticated";

export interface ReportSubmitResult {
  ok: boolean;
  reason: ReportSubmitReason;
  report_id?: string;
}

export interface MyPlaceReport {
  id: string;
  community_place_id: string;
  place_name: string;
  reason_code: PlaceReportReason;
  status: PlaceReportStatus;
  created_at: string;
}

export interface OwnerPlaceReport {
  id: string;
  community_place_id: string;
  place_name: string;
  place_maintenance_status: string;
  reason_code: PlaceReportReason;
  explanation: string;
  official_source_url: string | null;
  additional_details: string | null;
  status: PlaceReportStatus;
  owner_resolution: string | null;
  reporter_profile_id: string;
  created_at: string;
  resolved_at: string | null;
  open_same_reason_count: number;
}

export const REPORT_REASONS: Array<{
  value: PlaceReportReason;
  label: string;
  hint: string;
}> = [
  {
    value: "permanently_closed",
    label: "It has permanently closed",
    hint: "The place has shut down for good.",
  },
  {
    value: "temporarily_closed",
    label: "It is temporarily closed",
    hint: "Closed for renovation, holidays, or a short break.",
  },
  {
    value: "vegan_status_concern",
    label: "It may not be 100% vegan",
    hint: "You saw non-vegan items on the menu or were told otherwise.",
  },
  { value: "incorrect_name", label: "The name is wrong", hint: "The listed name doesn't match." },
  {
    value: "incorrect_location",
    label: "The location or address is wrong",
    hint: "The pin or address leads somewhere else.",
  },
  {
    value: "incorrect_source",
    label: "A link is wrong or outdated",
    hint: "The website or map link is broken or belongs to another place.",
  },
  {
    value: "duplicate_place",
    label: "This place is listed twice",
    hint: "The same place already appears elsewhere in VeggieMeet.",
  },
  { value: "other", label: "Something else", hint: "Tell us what you noticed." },
];

export const REPORT_REASON_LABEL: Record<PlaceReportReason, string> = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.value, r.label]),
) as Record<PlaceReportReason, string>;

/** Member-facing status wording. Never reveals internal moderation detail. */
export const REPORT_STATUS_LABEL: Record<PlaceReportStatus, string> = {
  pending: "Received",
  under_review: "Under review",
  resolved: "Reviewed",
  dismissed: "Reviewed",
  duplicate: "Already reported",
};

export const REPORT_STATUS_HINT: Record<PlaceReportStatus, string> = {
  pending: "Thanks — we'll review this soon.",
  under_review: "The VeggieMeet team is looking into this.",
  resolved: "We reviewed your report. Thank you for helping keep places accurate.",
  dismissed: "We reviewed your report and didn't make a change this time.",
  duplicate: "We already have a report about this issue.",
};

export const REPORT_LIMITS = {
  explanationMin: 20,
  explanation: 1000,
  officialSourceUrl: 500,
  additionalDetails: 1500,
};

export async function submitPlaceReport(input: {
  placeId: string;
  reasonCode: PlaceReportReason;
  explanation: string;
  officialSourceUrl?: string;
  additionalDetails?: string;
}): Promise<ReportSubmitResult> {
  const { data, error } = await rpc<ReportSubmitResult>("submit_community_place_report", {
    _place_id: input.placeId,
    _reason_code: input.reasonCode,
    _explanation: input.explanation,
    _official_source_url: input.officialSourceUrl?.trim() ? input.officialSourceUrl.trim() : null,
    _additional_details: input.additionalDetails?.trim() ? input.additionalDetails.trim() : null,
  });
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "invalid_input" };
}

export async function fetchMyPlaceReports(): Promise<MyPlaceReport[]> {
  const { data, error } = await rpc<MyPlaceReport[]>("get_my_place_reports");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchPlaceReportQueue(): Promise<OwnerPlaceReport[]> {
  const { data, error } = await rpc<OwnerPlaceReport[]>("get_place_report_queue");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type ReportModerationAction = "start_review" | "duplicate" | "dismiss" | "resolve";
export type ReportPlaceAction =
  | "needs_reverification"
  | "temporarily_closed"
  | "permanently_closed";

export async function moderatePlaceReport(input: {
  reportId: string;
  action: ReportModerationAction;
  note?: string;
  placeAction?: ReportPlaceAction | null;
}): Promise<{ ok: boolean; reason: string; status?: string }> {
  const { data, error } = await rpc<{ ok: boolean; reason: string; status?: string }>(
    "moderate_community_place_report",
    {
      _report_id: input.reportId,
      _action: input.action,
      _note: input.note?.trim() ? input.note.trim() : null,
      _place_action: input.placeAction ?? null,
    },
  );
  if (error) throw new Error(error.message);
  return data ?? { ok: false, reason: "unknown" };
}
