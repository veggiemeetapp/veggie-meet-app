import { describe, expect, it } from "vitest";
import { recoverPrimaryInterest } from "./meetupLegacyInterest";
import type { InterestOption } from "@/lib/onboarding";

const options = [
  { id: "coffee", label: "Coffee", category: "food_social" },
  { id: "walking", label: "Walking", category: "outdoors" },
  { id: "picnics", label: "Picnics", category: "food_social" },
] as unknown as InterestOption[];

describe("WO-134 / DEF-134-02 — Main interest recovery", () => {
  it("keeps a stored canonical id that is selectable", () => {
    expect(recoverPrimaryInterest("coffee", "other", options)).toEqual({
      primaryId: "coffee",
      mappedFromLegacy: false,
      needsRecovery: false,
    });
  });

  it("maps an unambiguous legacy category when no canonical id exists", () => {
    expect(recoverPrimaryInterest(null, "walk", options)).toEqual({
      primaryId: "walking",
      mappedFromLegacy: true,
      needsRecovery: false,
    });
    expect(recoverPrimaryInterest(null, "PICNIC", options).primaryId).toBe("picnics");
  });

  it("requires host recovery for residual or ambiguous legacy values", () => {
    expect(recoverPrimaryInterest(null, "other", options).needsRecovery).toBe(true);
    expect(recoverPrimaryInterest(null, "brunch", options).needsRecovery).toBe(true);
    expect(recoverPrimaryInterest(null, null, options).needsRecovery).toBe(true);
  });

  it("requires recovery when the stored id is no longer selectable", () => {
    expect(recoverPrimaryInterest("retired_thing", "other", options)).toEqual({
      primaryId: null,
      mappedFromLegacy: false,
      needsRecovery: true,
    });
  });

  it("never maps to an interest missing from the catalogue", () => {
    expect(recoverPrimaryInterest(null, "workshop", options).primaryId).toBeNull();
  });
});
