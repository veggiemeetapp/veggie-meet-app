import { describe, expect, it } from "vitest";
import {
  candidateSelectable,
  INVITE_DAILY_LIMIT,
  INVITE_SELECTION_MAX,
  isRateLimited,
  sendResultSummary,
  skipReasonLabel,
  type InviteCandidate,
  type SendInvitationsResult,
} from "./meetupInvites";

function candidate(over: Partial<InviteCandidate> = {}): InviteCandidate {
  return {
    profileId: "p1",
    displayName: "Maya Green",
    firstName: "Maya",
    avatarUrl: null,
    cityName: "Lisbon",
    alreadyAttending: false,
    alreadyInvited: false,
    invitationStatus: null,
    ...over,
  };
}

function result(over: Partial<SendInvitationsResult> = {}): SendInvitationsResult {
  return {
    invitedCount: 0,
    invitationIds: [],
    skipped: [],
    dailyLimit: INVITE_DAILY_LIMIT,
    remaining: INVITE_DAILY_LIMIT,
    windowHours: 24,
    windowStart: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("WO-144 invitation selection rules", () => {
  it("caps a batch at 20 recipients", () => {
    expect(INVITE_SELECTION_MAX).toBe(20);
  });

  it("excludes attending and already-invited Veggies from selection", () => {
    expect(candidateSelectable(candidate())).toBe(true);
    expect(candidateSelectable(candidate({ alreadyAttending: true }))).toBe(false);
    expect(candidateSelectable(candidate({ alreadyInvited: true }))).toBe(false);
  });

  it("labels every skip reason in member-safe language", () => {
    expect(skipReasonLabel("already_invited")).toBe("already invited");
    expect(skipReasonLabel("already_attending")).toBe("already attending");
    expect(skipReasonLabel("not_connected")).toBe("no longer connected");
    expect(skipReasonLabel("rate_limited")).toBe("daily invitation limit reached");
    expect(skipReasonLabel("blocked")).toBe("unavailable");
  });

  it("summarises a fully successful send without a skip note", () => {
    const s = sendResultSummary(
      result({ invitedCount: 3, invitationIds: ["a", "b", "c"], remaining: 47 }),
      () => "Maya",
    );
    expect(s.title).toBe("3 invitations sent");
    expect(s.description).toBeUndefined();
  });

  it("summarises partial sends with per-recipient reasons", () => {
    const s = sendResultSummary(
      result({
        invitedCount: 1,
        invitationIds: ["a"],
        skipped: [
          { profileId: "p2", reason: "already_invited" },
          { profileId: "p3", reason: "already_attending" },
        ],
      }),
      (id) => (id === "p2" ? "Leo" : "Priya"),
    );
    expect(s.title).toBe("1 invitation sent");
    expect(s.description).toContain("Leo — already invited");
    expect(s.description).toContain("Priya — already attending");
  });

  it("reports a zero-send batch as no invitations sent", () => {
    const s = sendResultSummary(
      result({ skipped: [{ profileId: "p2", reason: "not_connected" }] }),
      () => "Leo",
    );
    expect(s.title).toBe("No invitations sent");
  });
});

describe("WO-144B rolling invitation allowance", () => {
  it("sets the beta ceiling to 50 newly created invitations per 24 hours", () => {
    expect(INVITE_DAILY_LIMIT).toBe(50);
  });

  it("detects a fully rate-limited batch", () => {
    const r = result({
      remaining: 0,
      skipped: [
        { profileId: "p2", reason: "rate_limited" },
        { profileId: "p3", reason: "rate_limited" },
      ],
    });
    expect(isRateLimited(r)).toBe(true);
    const s = sendResultSummary(r, () => "Leo");
    expect(s.title).toBe("Daily invitation limit reached");
    expect(s.description).toContain("50");
    expect(s.description).toContain("24 hours");
    // Never names the recipients that were quota-blocked.
    expect(s.description).not.toContain("Leo");
  });

  it("does not treat a partially rate-limited batch as fully blocked", () => {
    const r = result({
      invitedCount: 2,
      invitationIds: ["a", "b"],
      remaining: 0,
      skipped: [{ profileId: "p3", reason: "rate_limited" }],
    });
    expect(isRateLimited(r)).toBe(false);
    expect(sendResultSummary(r, () => "Leo").title).toBe("2 invitations sent");
  });

  it("does not classify non-quota skips as rate limited", () => {
    expect(
      isRateLimited(result({ skipped: [{ profileId: "p2", reason: "unavailable" }] })),
    ).toBe(false);
  });
});
