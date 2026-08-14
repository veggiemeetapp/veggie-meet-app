import { describe, expect, it } from "vitest";
import {
  GOOGLE_VERIFICATION_BLOCKER,
  hasGoogleVerification,
  mapLifecycleError,
  publishBlockers,
  toGoogleIdentityPatch,
} from "./candidatePublish";
import type { GoogleCandidate, PlaceCandidate } from "./placeVerification";

const google: GoogleCandidate = {
  place_id: "ChIJfilthyvegan",
  display_name: "Filthy Vegan",
  formatted_address: "86 Cô Bắc, District 1, Ho Chi Minh City",
  latitude: 10.7626,
  longitude: 106.6942,
  google_maps_url: "https://maps.google.com/?cid=1",
  business_status: "OPERATIONAL",
  primary_type: "restaurant",
  website_url: "https://filthyvegan.example",
};

function candidate(over: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    id: "c1",
    google_place_id: null,
    google_display_name: null,
    google_formatted_address: null,
    google_primary_type: null,
    google_maps_url: null,
    google_website_url: null,
    business_status: null,
    latitude: null,
    longitude: null,
    display_name: "Filthy Vegan",
    public_display_name: "Filthy Vegan",
    public_address: null,
    category: "restaurant",
    veggie_classification: "fully_vegan",
    veggie_reason: "Fully plant-based menu",
    description: "A fully vegan kitchen in District 1 serving comfort food.",
    district: "District 1",
    group_suitability: null,
    cover_image_url: null,
    image_source: null,
    image_rights_status: "none",
    verification_notes: "Owner verified menu",
    verification_status: "draft",
    review_order: null,
    source: "owner",
    published_place_id: null,
    published_at: null,
    ...over,
  };
}

const confirmed = {
  google_place_id: google.place_id,
  google_formatted_address: google.formatted_address,
  latitude: google.latitude,
  longitude: google.longitude,
  business_status: "OPERATIONAL",
} as Partial<PlaceCandidate>;

describe("candidate publish gate copy (WO-103)", () => {
  it("shows one understandable blocker when Google verification is missing", () => {
    const blockers = publishBlockers(candidate());
    expect(blockers).toContain(GOOGLE_VERIFICATION_BLOCKER);
    // No technical coordinate/identity wording is surfaced to the owner.
    expect(blockers.filter((b) => /latitude|longitude|Place ID|coordinate/i.test(b))).toEqual([]);
    expect(blockers).toHaveLength(1);
  });


  it("removes the verification blocker once a Google result is confirmed", () => {
    const blockers = publishBlockers(candidate(confirmed));
    expect(blockers).toEqual([]);
  });

  it("still blocks non-operational businesses", () => {
    expect(
      publishBlockers(candidate({ ...confirmed, business_status: "CLOSED_PERMANENTLY" })),
    ).toContain("Google business status is CLOSED_PERMANENTLY");
  });
});

describe("Google identity import (WO-103)", () => {
  it("populates every required identity and location field", () => {
    const patch = toGoogleIdentityPatch(google);
    expect(patch).toMatchObject({
      google_place_id: "ChIJfilthyvegan",
      google_formatted_address: google.formatted_address,
      latitude: 10.7626,
      longitude: 106.6942,
      business_status: "OPERATIONAL",
      google_primary_type: "restaurant",
      google_website_url: "https://filthyvegan.example",
    });
  });

  it("preserves curated VeggieMeet copy — no curated keys in the patch", () => {
    const patch = toGoogleIdentityPatch(google)!;
    for (const key of [
      "public_display_name",
      "category",
      "district",
      "veggie_classification",
      "veggie_reason",
      "description",
      "verification_notes",
    ]) {
      expect(patch).not.toHaveProperty(key);
    }
    const base = candidate();
    const mergedCandidate = { ...base, ...patch };
    expect(mergedCandidate.description).toBe(base.description);
    expect(mergedCandidate.veggie_reason).toBe(base.veggie_reason);
  });

  it("refuses to treat an incomplete Google result as verified", () => {
    expect(toGoogleIdentityPatch({ ...google, latitude: null })).toBeNull();
    expect(toGoogleIdentityPatch({ ...google, formatted_address: null })).toBeNull();
    expect(toGoogleIdentityPatch({ ...google, place_id: null })).toBeNull();
    expect(toGoogleIdentityPatch({ ...google, longitude: 999 })).toBeNull();
    expect(hasGoogleVerification(candidate())).toBe(false);
    expect(hasGoogleVerification(candidate(confirmed))).toBe(true);
  });
});

describe("lifecycle error mapping (WO-104)", () => {
  it("maps server lifecycle errors to owner-safe copy", () => {
    expect(mapLifecycleError("Candidate must be marked verified before publishing.")).toBe(
      "Candidate is missing required verification details.",
    );
    expect(mapLifecycleError("Candidate already published.")).toBe(
      "This place has already been published.",
    );
    expect(mapLifecycleError("This Google Place is already represented in Community Places.")).toBe(
      "This Google Place is already represented in Community Places.",
    );
    expect(mapLifecycleError("Google reports this business is not operational.")).toBe(
      "Google reports this business is not operational.",
    );
    expect(mapLifecycleError("This candidate was rejected and cannot be published.")).toBe(
      "This candidate was rejected and cannot be published.",
    );
    expect(mapLifecycleError("permission denied")).toBe(
      "Only the VeggieMeet owner can verify and publish places.",
    );
  });

  it("never leaks raw Postgres internals", () => {
    const raw = 'ERROR:  P0001 function public.publish_place_candidate(uuid) line 42 at RAISE';
    const msg = mapLifecycleError(raw);
    expect(msg).not.toMatch(/P0001|public\.|RAISE|uuid/);
  });
});
