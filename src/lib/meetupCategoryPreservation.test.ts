import { describe, expect, it } from "vitest";
import { resolveCategoryUpdate } from "./meetupInterestDraft";

/**
 * WO-149B — an unrelated Meetup edit must never rewrite the stored category
 * columns. `update_hosted_meetup` preserves `primary_interest_id`,
 * `additional_interest_ids` and the legacy `category` enum verbatim when no main
 * category is supplied, so the client omits them unless the host explicitly
 * changed a category.
 */
describe("resolveCategoryUpdate", () => {
  it("omits the category write for an untouched draft (current shape)", () => {
    expect(
      resolveCategoryUpdate(false, "vegan_food", ["coffee", "festivals"]),
    ).toEqual({ primaryInterestId: null });
  });

  it("preserves malformed legacy shapes by omitting the write", () => {
    // duplicated, main-as-optional, over-limit, unknown and retired ids
    const shapes: Array<[string | null, string[]]> = [
      ["coffee", ["coffee", "coffee", "walking"]],
      ["vegan_food", ["a", "b", "c", "d"]],
      ["vegan_food", ["retired_thing", "unknown_id"]],
      [null, ["orphan_optional"]],
      ["  ", ["  ", ""]],
    ];
    for (const [primary, additional] of shapes) {
      expect(resolveCategoryUpdate(false, primary, additional)).toEqual({
        primaryInterestId: null,
      });
    }
  });

  it("omits the write when the host has no usable main category, even if touched", () => {
    expect(resolveCategoryUpdate(true, null, ["coffee"])).toEqual({
      primaryInterestId: null,
    });
    expect(resolveCategoryUpdate(true, "   ", [])).toEqual({ primaryInterestId: null });
  });

  it("writes the confirmed main category and keeps unchanged optionals", () => {
    expect(resolveCategoryUpdate(true, "yoga", ["coffee", "festivals"])).toEqual({
      primaryInterestId: "yoga",
      additionalInterestIds: ["coffee", "festivals"],
    });
  });

  it("prevents duplicates and main-as-optional on a confirmed change", () => {
    expect(resolveCategoryUpdate(true, "coffee", ["coffee", "walking", "walking"])).toEqual({
      primaryInterestId: "coffee",
      additionalInterestIds: ["walking"],
    });
  });

  it("caps a confirmed change at two optional categories", () => {
    expect(resolveCategoryUpdate(true, "coffee", ["a", "b", "c"])).toEqual({
      primaryInterestId: "coffee",
      additionalInterestIds: ["a", "b"],
    });
  });
});
