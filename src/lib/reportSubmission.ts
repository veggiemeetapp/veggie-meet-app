/**
 * WO-140 — Meetup report submission contract.
 *
 * Root cause of the WO-140 defect: the member-facing report dialogs sent the
 * human-readable reason *label* ("Other") while `public.report_meetup` /
 * `public.submit_profile_report` validate the canonical reason *code*
 * ("other") via `public._valid_report_reason`. Every submission was rejected
 * server-side with `Invalid reason`, which the member-safe error layer then
 * rendered as the generic "Something went wrong. Nothing was saved."
 *
 * This module is the single client-side source of truth for
 *   - which reason codes the server accepts (mirrors `_valid_report_reason`), and
 *   - how a failed submission is described to a member.
 *
 * The reporter identity is never supplied by the client: `report_meetup` is
 * SECURITY DEFINER and derives it from `current_profile_id()`.
 */

import {
  MEETUP_REPORT_REASONS,
  MESSAGE_REPORT_REASONS,
  PROFILE_REPORT_REASONS,
  SAFETY_REASONS,
} from "@/lib/safety";
import { normalizeError } from "@/lib/errors";

export type ReportKind = "meetup" | "profile" | "message" | "safety";

/** Maximum length of the optional free-text details field (server: 1000). */
export const REPORT_DETAILS_MAX = 1000;

const REASON_CODES: Record<ReportKind, readonly string[]> = {
  meetup: MEETUP_REPORT_REASONS.map((r) => r.id),
  profile: PROFILE_REPORT_REASONS.map((r) => r.id),
  message: MESSAGE_REPORT_REASONS.map((r) => r.id),
  safety: SAFETY_REASONS.map((r) => r.id),
};

/** Canonical reason codes the server accepts for a report kind. */
export function reportReasonCodes(kind: ReportKind): readonly string[] {
  return REASON_CODES[kind];
}

/** True only for a canonical code (never for a display label). */
export function isCanonicalReportReason(kind: ReportKind, code: string): boolean {
  return REASON_CODES[kind].includes(code);
}

export type ReportErrorCategory =
  | "auth"
  | "invalid_meetup"
  | "invalid_reason"
  | "invalid_details"
  | "duplicate"
  | "rate_limited"
  | "offline"
  | "unknown";

export interface ReportErrorInfo {
  category: ReportErrorCategory;
  /** Member-safe, actionable copy. Never contains internal detail. */
  message: string;
  /** True when submitting the same form again can succeed. */
  retryable: boolean;
}

const COPY: Record<ReportErrorCategory, { message: string; retryable: boolean }> = {
  auth: {
    message: "Your session has expired. Sign in again and resend this report.",
    retryable: false,
  },
  invalid_meetup: {
    message: "This Meetup is no longer available, so it can't be reported.",
    retryable: false,
  },
  invalid_reason: {
    message: "Please choose a reason from the list and submit again.",
    retryable: true,
  },
  invalid_details: {
    message: `Please shorten your details to ${REPORT_DETAILS_MAX} characters or fewer.`,
    retryable: true,
  },
  duplicate: {
    message: "You have already reported this. Our team is reviewing it.",
    retryable: false,
  },
  rate_limited: {
    message: "You've sent several reports just now. Please wait a moment and try again.",
    retryable: true,
  },
  offline: {
    message: "You appear to be offline. Nothing was saved — reconnect and try again.",
    retryable: true,
  },
  unknown: {
    message: "We couldn't send your report. Nothing was saved. Please try again.",
    retryable: true,
  },
};

function rawOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/**
 * Maps a raw submission failure onto the member-safe report taxonomy. The raw
 * error stays available to the caller for diagnostics; only `message` is shown.
 */
export function describeReportError(error: unknown): ReportErrorInfo {
  const raw = rawOf(error).toLowerCase();
  const normalized = normalizeError(error);

  let category: ReportErrorCategory = "unknown";
  if (normalized.category === "offline") category = "offline";
  else if (normalized.category === "auth_expired" || raw.includes("not authenticated"))
    category = "auth";
  else if (raw.includes("meetup not found") || raw.includes("not found")) category = "invalid_meetup";
  else if (raw.includes("invalid reason") || raw.includes("reason required"))
    category = "invalid_reason";
  else if (raw.includes("details too long")) category = "invalid_details";
  else if (raw.includes("already reported")) category = "duplicate";
  else if (normalized.category === "rate_limited") category = "rate_limited";

  return { category, ...COPY[category] };
}
