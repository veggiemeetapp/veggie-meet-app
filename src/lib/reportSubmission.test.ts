import { describe, expect, it } from "vitest";
import {
  describeReportError,
  isCanonicalReportReason,
  reportReasonCodes,
  REPORT_DETAILS_MAX,
} from "./reportSubmission";
import { MEETUP_REPORT_REASONS } from "./safety";

/** WO-140 — pins the reason contract and the member-safe error taxonomy. */

describe("canonical reason codes", () => {
  it("mirrors the server meetup taxonomy", () => {
    expect(reportReasonCodes("meetup")).toEqual([
      "misleading_information",
      "unsafe_environment",
      "inappropriate_host_behavior",
      "harassment",
      "discrimination",
      "cancelled_without_notice",
      "other",
    ]);
  });

  it("accepts every canonical meetup code", () => {
    for (const r of MEETUP_REPORT_REASONS) {
      expect(isCanonicalReportReason("meetup", r.id)).toBe(true);
    }
  });

  it("rejects display labels (the WO-140 root cause)", () => {
    for (const r of MEETUP_REPORT_REASONS) {
      if (r.id === r.label) continue;
      expect(isCanonicalReportReason("meetup", r.label)).toBe(false);
    }
    expect(isCanonicalReportReason("meetup", "Other")).toBe(false);
    expect(isCanonicalReportReason("meetup", "not_a_reason")).toBe(false);
  });

  it("keeps the 1000 character details limit", () => {
    expect(REPORT_DETAILS_MAX).toBe(1000);
  });
});

describe("describeReportError", () => {
  const cases: Array<[string, string]> = [
    ["Not authenticated", "auth"],
    ["Meetup not found", "invalid_meetup"],
    ["Invalid reason", "invalid_reason"],
    ["Reason required", "invalid_reason"],
    ["Details too long", "invalid_details"],
    ["Already reported", "duplicate"],
    ["Failed to fetch", "offline"],
  ];

  it.each(cases)("maps %s", (raw, category) => {
    expect(describeReportError(new Error(raw)).category).toBe(category);
  });

  it("falls back to unknown for unexpected server failures", () => {
    const info = describeReportError({
      message: 'duplicate key value violates unique constraint "meetup_reports_pkey"',
      code: "23505",
    });
    expect(info.category).toBe("unknown");
    expect(info.retryable).toBe(true);
  });

  it("never leaks internal detail in member copy", () => {
    const leaky = [
      'permission denied for relation public.meetup_reports',
      "PL/pgSQL function public.report_meetup(uuid,text,text) line 12",
      "new row violates row-level security policy",
      "63ddbe05-b821-4261-a6f1-3c0358414a97 not found in supabase",
    ];
    for (const raw of leaky) {
      const msg = describeReportError(new Error(raw)).message.toLowerCase();
      for (const frag of [
        "permission",
        "relation",
        "policy",
        "row-level",
        "pl/pgsql",
        "supabase",
        "public.",
        "63ddbe05",
        "constraint",
        "sql",
      ]) {
        expect(msg).not.toContain(frag);
      }
    }
  });
});
