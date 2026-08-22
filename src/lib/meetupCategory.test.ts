import { describe, expect, it } from "vitest";
import { legacyCategoryLabel, resolveMeetupCategoryLabel } from "@/lib/meetupCategory";

/**
 * WO-126A / DEF-126-01 — the canonical Primary interest is the source of truth
 * for every member-visible Meetup category label. The residual legacy enum
 * member `other` must never surface for a Meetup that has canonical data.
 */
describe("resolveMeetupCategoryLabel", () => {
  const labels = { yoga: "Yoga", coffee: "Coffee" };

  it("prefers the canonical label over the legacy enum", () => {
    expect(resolveMeetupCategoryLabel("yoga", "other", labels)).toBe("Yoga");
    expect(resolveMeetupCategoryLabel("coffee", "coffee", labels)).toBe("Coffee");
  });

  it("never falls back to 'Other' when a canonical id exists", () => {
    expect(resolveMeetupCategoryLabel("yoga", "other", undefined)).toBeNull();
    expect(resolveMeetupCategoryLabel("retired_id", "other", labels)).toBeNull();
  });

  it("uses the legacy label only for historical meetups without canonical tags", () => {
    expect(resolveMeetupCategoryLabel(null, "dinner", labels)).toBe("Dinner");
    expect(resolveMeetupCategoryLabel("  ", "walk", labels)).toBe("Walk");
    // The residual `other` enum member is never a real category label.
    expect(resolveMeetupCategoryLabel(undefined, "other", labels)).toBeNull();
  });

  it("renders nothing when there is no usable classification at all", () => {
    expect(resolveMeetupCategoryLabel(null, null, labels)).toBeNull();
    expect(resolveMeetupCategoryLabel(null, "not_an_enum_member", labels)).toBeNull();
  });

  it("maps legacy enum members to human labels", () => {
    expect(legacyCategoryLabel("workshop")).toBe("Workshop");
    expect(legacyCategoryLabel("BRUNCH")).toBe("Brunch");
    expect(legacyCategoryLabel(null)).toBeNull();
    expect(legacyCategoryLabel("other")).toBeNull();
  });
});
