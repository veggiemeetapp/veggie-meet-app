import { describe, expect, it } from "vitest";
import { normalizeAdditionalInterestIds } from "./meetupInterestDraft";

/**
 * WO-149 — legacy/older Meetup category shapes must normalise deterministically
 * for the draft and the save payload, without inventing or reordering data.
 */
describe("normalizeAdditionalInterestIds", () => {
  it("keeps a healthy current-shape record untouched", () => {
    expect(normalizeAdditionalInterestIds("vegan_food", ["coffee", "festivals"])).toEqual([
      "coffee",
      "festivals",
    ]);
  });

  it("removes the main category from the optional list", () => {
    expect(normalizeAdditionalInterestIds("coffee", ["coffee", "walking"])).toEqual([
      "walking",
    ]);
  });

  it("collapses duplicates while preserving original order", () => {
    expect(
      normalizeAdditionalInterestIds("vegan_food", ["walking", "walking", "coffee"]),
    ).toEqual(["walking", "coffee"]);
  });

  it("caps the optional list at two", () => {
    expect(
      normalizeAdditionalInterestIds("vegan_food", ["a", "b", "c", "d"]),
    ).toEqual(["a", "b"]);
  });

  it("fails safely on missing, empty and malformed shapes", () => {
    expect(normalizeAdditionalInterestIds(null, null)).toEqual([]);
    expect(normalizeAdditionalInterestIds(null, undefined)).toEqual([]);
    expect(
      normalizeAdditionalInterestIds("  ", ["  ", "", null as unknown as string, "coffee"]),
    ).toEqual(["coffee"]);
  });

  it("preserves unknown/retired optional ids rather than dropping history", () => {
    expect(normalizeAdditionalInterestIds("coffee", ["retired_thing"])).toEqual([
      "retired_thing",
    ]);
  });
});
