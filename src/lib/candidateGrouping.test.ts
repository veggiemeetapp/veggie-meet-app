import { describe, expect, it } from "vitest";
import {
  CANDIDATE_GROUP_DEFAULT_OPEN,
  CANDIDATE_GROUP_ORDER,
  candidateGroupOf,
  groupCandidates,
  groupCountLabel,
  sortCandidateGroup,
} from "@/lib/candidateGrouping";

const c = (over: Record<string, unknown>) =>
  ({
    id: "x",
    display_name: "X",
    public_display_name: null,
    public_address: null,
    google_display_name: null,
    google_formatted_address: null,
    google_place_id: null,
    district: null,
    category: null,
    verification_status: "draft",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as never;

describe("candidateGroupOf", () => {
  it("maps canonical backend statuses", () => {
    expect(candidateGroupOf("draft")).toBe("draft");
    expect(candidateGroupOf("published")).toBe("published");
    expect(candidateGroupOf("rejected")).toBe("rejected");
  });

  it("folds in-flight lifecycle statuses into the active Draft queue", () => {
    expect(candidateGroupOf("needs_review")).toBe("draft");
    expect(candidateGroupOf("verified")).toBe("draft");
  });

  it("never hides an unknown or missing status", () => {
    expect(candidateGroupOf("brand_new_status")).toBe("draft");
    expect(candidateGroupOf(null)).toBe("draft");
    expect(candidateGroupOf(undefined)).toBe("draft");
  });
});

describe("groupCandidates", () => {
  const rows = [
    c({ id: "a", display_name: "Hum", district: "District 1", category: "restaurant" }),
    c({ id: "b", display_name: "Green Bowl", verification_status: "needs_review" }),
    c({
      id: "p",
      display_name: "Pasteur",
      verification_status: "published",
      published_at: "2026-02-01T00:00:00Z",
    }),
    c({ id: "r", display_name: "Diner", verification_status: "rejected" }),
  ];

  it("keeps the required section order", () => {
    expect(groupCandidates(rows).map((g) => g.key)).toEqual(CANDIDATE_GROUP_ORDER);
  });

  it("returns accurate totals and match counts", () => {
    const g = groupCandidates(rows);
    expect(g.map((x) => x.totalCount)).toEqual([2, 1, 1]);

    const filtered = groupCandidates(rows, "district 1");
    expect(filtered[0].matchCount).toBe(1);
    expect(filtered[0].totalCount).toBe(2);
    expect(filtered[1].matchCount).toBe(0);
  });

  it("is case-insensitive and searches every status", () => {
    expect(groupCandidates(rows, "DINER")[2].matchCount).toBe(1);
    expect(groupCandidates(rows, "pasteur")[1].matchCount).toBe(1);
  });

  it("resolves city names through the supplied lookup", () => {
    const withCity = [c({ id: "a", city_id: "city-1" })];
    const g = groupCandidates(withCity, "saigon", (id) =>
      id === "city-1" ? "Saigon" : null,
    );
    expect(g[0].matchCount).toBe(1);
  });

  it("handles an empty dataset", () => {
    expect(groupCandidates(undefined).every((g) => g.totalCount === 0)).toBe(true);
  });
});

describe("sorting and labels", () => {
  it("sorts drafts by updated_at desc", () => {
    const out = sortCandidateGroup("draft", [
      c({ id: "old", updated_at: "2026-01-01T00:00:00Z" }),
      c({ id: "new", updated_at: "2026-06-01T00:00:00Z" }),
    ]);
    expect(out.map((r: { id: string }) => r.id)).toEqual(["new", "old"]);
  });

  it("sorts published by published_at desc, falling back to updated_at", () => {
    const out = sortCandidateGroup("published", [
      c({ id: "a", published_at: "2026-01-01T00:00:00Z" }),
      c({ id: "b", published_at: "2026-09-01T00:00:00Z" }),
      c({ id: "c", published_at: null, updated_at: "2026-08-01T00:00:00Z" }),
    ]);
    expect(out.map((r: { id: string }) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("labels counts as total when idle and filtered when searching", () => {
    const g = { key: "draft" as const, label: "Draft", items: [], matchCount: 2, totalCount: 11 };
    expect(groupCountLabel(g, false)).toBe("11");
    expect(groupCountLabel(g, true)).toBe("2 of 11");
  });

  it("opens only Draft by default", () => {
    expect(CANDIDATE_GROUP_DEFAULT_OPEN).toEqual({
      draft: true,
      published: false,
      rejected: false,
    });
  });
});
