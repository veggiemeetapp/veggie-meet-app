import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

import {
  ACTIVE_STATUSES,
  isActiveSuggestion,
  fetchSuggestionQueue,
  promoteSuggestion,
  type SuggestionStatus,
} from "./placeSuggestions";

/** WO-109 DEF-109-01 — Active queue holds only actionable suggestions; handled
 *  ones live in History without being deleted. */
describe("suggestion lifecycle scopes", () => {
  beforeEach(() => rpcMock.mockReset());

  it("treats pending and under_review as active", () => {
    expect(ACTIVE_STATUSES).toEqual(["pending", "under_review"]);
    expect(isActiveSuggestion("pending")).toBe(true);
    expect(isActiveSuggestion("under_review")).toBe(true);
  });

  it("keeps promoted, rejected and duplicate out of active", () => {
    (["approved", "rejected", "duplicate"] as SuggestionStatus[]).forEach((s) =>
      expect(isActiveSuggestion(s)).toBe(false),
    );
  });

  it("requests the active scope by default", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchSuggestionQueue();
    expect(rpcMock).toHaveBeenCalledWith("get_place_suggestion_queue", { _scope: "active" });
  });

  it("requests the history scope explicitly", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchSuggestionQueue("history");
    expect(rpcMock).toHaveBeenCalledWith("get_place_suggestion_queue", { _scope: "history" });
  });

  it("returns server rows unchanged (no client-side hiding)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: "a", moderation_status: "approved", resolved_at: "2026-08-14T00:00:00Z" }],
      error: null,
    });
    const rows = await fetchSuggestionQueue("history");
    expect(rows).toHaveLength(1);
    expect(rows[0].moderation_status).toBe("approved");
  });

  it("surfaces an already-promoted result instead of creating a second candidate", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, reason: "already_promoted" }, error: null });
    await expect(promoteSuggestion("a")).resolves.toEqual({
      ok: false,
      reason: "already_promoted",
    });
  });
});
