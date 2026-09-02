import { describe, expect, it } from "vitest";
import {
  candidateSelectable,
  INVITE_SELECTION_MAX,
  sendResultSummary,
  skipReasonLabel,
  type InviteCandidate,
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
    expect(skipReasonLabel("blocked")).toBe("unavailable");
  });

  it("summarises a fully successful send without a skip note", () => {
    const s = sendResultSummary(
      { invitedCount: 3, invitationIds: ["a", "b", "c"], skipped: [] },
      () => "Maya",
    );
    expect(s.title).toBe("3 invitations sent");
    expect(s.description).toBeUndefined();
  });

  it("summarises partial sends with per-recipient reasons", () => {
    const s = sendResultSummary(
      {
        invitedCount: 1,
        invitationIds: ["a"],
        skipped: [
          { profileId: "p2", reason: "already_invited" },
          { profileId: "p3", reason: "already_attending" },
        ],
      },
      (id) => (id === "p2" ? "Leo" : "Priya"),
    );
    expect(s.title).toBe("1 invitation sent");
    expect(s.description).toContain("Leo — already invited");
    expect(s.description).toContain("Priya — already attending");
  });

  it("reports a zero-send batch as no invitations sent", () => {
    const s = sendResultSummary(
      {
        invitedCount: 0,
        invitationIds: [],
        skipped: [{ profileId: "p2", reason: "not_connected" }],
      },
      () => "Leo",
    );
    expect(s.title).toBe("No invitations sent");
  });
});
