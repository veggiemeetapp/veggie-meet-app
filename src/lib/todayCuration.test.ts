import { describe, expect, it } from "vitest";
import {
  isTodayEligible,
  mapCurationError,
  moveFeatured,
  operationalLabel,
  splitCuration,
  type CurationPlace,
} from "./todayCuration";

const place = (over: Partial<CurationPlace>): CurationPlace => ({
  place_id: over.place_id ?? "p",
  name: over.name ?? "Place",
  category: "restaurant",
  is_active: true,
  maintenance_status: "operational",
  verification_status: "verified",
  state: "normal",
  featured_rank: null,
  ...over,
});

describe("splitCuration", () => {
  it("orders featured by owner rank and buckets the rest", () => {
    const res = splitCuration([
      place({ place_id: "b", name: "B", state: "featured", featured_rank: 2 }),
      place({ place_id: "a", name: "A", state: "featured", featured_rank: 1 }),
      place({ place_id: "n", name: "N" }),
      place({ place_id: "h", name: "H", state: "hidden" }),
    ]);
    expect(res.featured.map((p) => p.place_id)).toEqual(["a", "b"]);
    expect(res.normal.map((p) => p.place_id)).toEqual(["n"]);
    expect(res.hidden.map((p) => p.place_id)).toEqual(["h"]);
  });

  it("returns empty buckets with no curation at all", () => {
    const res = splitCuration([]);
    expect(res).toEqual({ featured: [], normal: [], hidden: [] });
  });
});

describe("moveFeatured", () => {
  it("moves a place up", () => {
    expect(moveFeatured(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
  });
  it("moves a place down", () => {
    expect(moveFeatured(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
  });
  it("is a no-op at the boundaries", () => {
    expect(moveFeatured(["a", "b"], 0, "up")).toEqual(["a", "b"]);
    expect(moveFeatured(["a", "b"], 1, "down")).toEqual(["a", "b"]);
  });
  it("never duplicates or drops an id", () => {
    const out = moveFeatured(["a", "b", "c"], 2, "up");
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("isTodayEligible", () => {
  it("keeps operational active places eligible", () => {
    expect(isTodayEligible(place({}))).toBe(true);
  });
  it("excludes inactive places even when featured", () => {
    expect(isTodayEligible(place({ is_active: false, state: "featured" }))).toBe(false);
  });
  it("excludes permanently closed places", () => {
    expect(isTodayEligible(place({ maintenance_status: "permanently_closed" }))).toBe(false);
  });
});

describe("operationalLabel", () => {
  it("is textual for every state", () => {
    expect(operationalLabel(place({}))).toBe("Operational");
    expect(operationalLabel(place({ is_active: false }))).toBe("Hidden from discovery");
    expect(operationalLabel(place({ maintenance_status: "temporarily_closed" }))).toBe(
      "Temporarily closed",
    );
  });
});

describe("mapCurationError", () => {
  it("never leaks raw SQL", () => {
    expect(mapCurationError('ERROR: duplicate key value violates unique constraint "x"')).toBe(
      "Couldn’t save that change. Please try again.",
    );
  });
  it("explains the slot limit", () => {
    expect(mapCurationError("Today shows up to 3 Community Places.")).toContain("up to 3");
  });
  it("explains an authorization failure", () => {
    expect(mapCurationError("Not authorized")).toContain("owner");
  });
});
