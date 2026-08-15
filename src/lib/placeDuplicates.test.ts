import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

import {
  ACTIVE_STATUSES,
  DUPLICATE_REASON_LABEL,
  checkSuggestionDuplicate,
  isActiveSuggestion,
  submitPlaceSuggestion,
  type DuplicateCheck,
  type SuggestionStatus,
} from "./placeSuggestions";

const INPUT = {
  cityId: "city-1",
  placeName: "Roots Plant-based Cafe - Ben Thanh",
  addressText: "113-115 Lý Tự Trọng, P. Bến Thành, Hồ Chí Minh 70000, Vietnam",
  officialSourceUrl: "https://rootsplantbasedcafe.com/",
  veganReason: "Fully vegan menu.",
};

/** WO-110 DEF-110-01 — a different branch of the same brand is a possible match,
 *  never a hard block. DEF-110-02 — a possible match still enters the owner
 *  Needs review queue as a pending suggestion. */
describe("branch-aware duplicate handling", () => {
  beforeEach(() => rpcMock.mockReset());

  it("treats a same-brand different-address match as possible, not blocking", async () => {
    const server: DuplicateCheck = {
      level: "possible",
      entity_type: "place",
      match_id: "place-1",
      match_name: "Roots Plant-Based Cafe - Hẻm 41 Xuan Thuy",
      match_address: "Hẻm 41 Xuân Thủy, An Khánh",
      match_status: "published",
      published_place_id: "place-1",
      reasons: ["similar_name", "same_official_website"],
    };
    rpcMock.mockResolvedValue({ data: server, error: null });
    const res = await checkSuggestionDuplicate(INPUT);
    expect(res.level).toBe("possible");
    expect(res.reasons).toContain("similar_name");
    expect(rpcMock).toHaveBeenCalledWith("check_community_place_suggestion_duplicate", {
      _city_id: INPUT.cityId,
      _place_name: INPUT.placeName,
      _address_text: INPUT.addressText,
      _official_source_url: INPUT.officialSourceUrl,
    });
  });

  it("classifies the same physical address in the same city as a hard duplicate", async () => {
    rpcMock.mockResolvedValue({
      data: {
        level: "hard",
        entity_type: "place",
        match_name: "Ivegan Supershop — Bến Thành",
        published_place_id: "place-2",
        reasons: ["same_address_same_city"],
      },
      error: null,
    });
    const res = await checkSuggestionDuplicate(INPUT);
    expect(res.level).toBe("hard");
    expect(res.published_place_id).toBe("place-2");
  });

  it("allows the same brand name in a different city", async () => {
    rpcMock.mockResolvedValue({ data: { level: "none" }, error: null });
    await expect(checkSuggestionDuplicate(INPUT)).resolves.toEqual({ level: "none" });
  });

  it("stores a possible-duplicate submission as an actionable suggestion", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, reason: "success", suggestion_id: "s1", possible_duplicate: true },
      error: null,
    });
    const res = await submitPlaceSuggestion(INPUT);
    expect(res.ok).toBe(true);
    expect(res.possible_duplicate).toBe(true);
    expect(res.suggestion_id).toBe("s1");
  });

  it("surfaces the published place when the exact location already exists", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: false,
        reason: "duplicate_published_place",
        match_name: "Ivegan Supershop — Bến Thành",
        published_place_id: "place-2",
      },
      error: null,
    });
    const res = await submitPlaceSuggestion(INPUT);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("duplicate_published_place");
    expect(res.published_place_id).toBe("place-2");
  });

  it("labels every duplicate reason with owner-safe wording (no scores)", () => {
    Object.values(DUPLICATE_REASON_LABEL).forEach((label) => {
      expect(label).toMatch(/[a-z]/i);
      expect(label).not.toMatch(/\d/);
    });
  });

  /** WO-110 §25/§50 — no suggestion may be invisible from both owner scopes. */
  it("maps every moderation status to exactly one owner scope", () => {
    const all: SuggestionStatus[] = [
      "pending",
      "under_review",
      "approved",
      "rejected",
      "duplicate",
    ];
    const active = all.filter(isActiveSuggestion);
    const history = all.filter((s) => !isActiveSuggestion(s));
    expect(active).toEqual(ACTIVE_STATUSES);
    expect(history).toEqual(["approved", "rejected", "duplicate"]);
    expect([...active, ...history].sort()).toEqual([...all].sort());
    expect(active.some((s) => history.includes(s))).toBe(false);
  });
});
