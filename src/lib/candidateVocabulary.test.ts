import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_INVALID_MESSAGE,
  IMAGE_RIGHTS_INVALID_MESSAGE,
  IMAGE_RIGHTS_OPTIONS,
  PLACE_CATEGORIES,
  VEGGIE_CLASSIFICATIONS,
  isValidCategory,
  isValidClassification,
  isValidImageRights,
  labelFor,
  mapCandidateConstraintError,
  validateCandidatePatch,
} from "./candidateVocabulary";
import { publishBlockers } from "./candidatePublish";
import type { PlaceCandidate } from "./placeVerification";

/** Live production contract (WO-108 audit, backend bmlchfrhdcafyfysnfok). */
const LIVE_CLASSIFICATIONS = [
  "fully_vegan",
  "fully_vegetarian",
  "vegetarian_friendly",
  "vegan_options",
  "not_food",
];
const LIVE_IMAGE_RIGHTS = ["none", "owner_supplied", "restaurant_supplied", "licensed"];
const LIVE_CATEGORIES = ["restaurant", "cafe", "park", "market", "studio", "venue"];

describe("WO-108 canonical vocabularies mirror the live database CHECKs", () => {
  it("classification options match the live constraint exactly", () => {
    expect(VEGGIE_CLASSIFICATIONS.map((o) => o.value)).toEqual(LIVE_CLASSIFICATIONS);
  });

  it("image rights options match the live constraint exactly", () => {
    expect(IMAGE_RIGHTS_OPTIONS.map((o) => o.value)).toEqual(LIVE_IMAGE_RIGHTS);
  });

  it("category options match the place_category enum exactly", () => {
    expect(PLACE_CATEGORIES.map((o) => o.value)).toEqual(LIVE_CATEGORIES);
  });

  it("exposes human labels, never raw tokens", () => {
    expect(labelFor(VEGGIE_CLASSIFICATIONS, "fully_vegan")).toBe("100% vegan");
    for (const o of [...VEGGIE_CLASSIFICATIONS, ...IMAGE_RIGHTS_OPTIONS, ...PLACE_CATEGORIES]) {
      expect(o.label).not.toMatch(/_/);
    }
  });
});

describe("WO-108 client-side validation follows the live nullability contract", () => {
  it("accepts every canonical classification and NULL for drafts", () => {
    for (const v of LIVE_CLASSIFICATIONS) expect(isValidClassification(v)).toBe(true);
    expect(isValidClassification(null)).toBe(true);
  });

  it("rejects arbitrary text, empty strings and case/whitespace variants", () => {
    for (const bad of ["", " fully_vegan ", "Fully Vegan", "fully vegan", "vegan", "weird"]) {
      expect(isValidClassification(bad)).toBe(false);
    }
  });

  it("requires image rights (NOT NULL in production) and a valid category", () => {
    expect(isValidImageRights(null)).toBe(false);
    expect(isValidImageRights("cleared")).toBe(false);
    expect(isValidImageRights("none")).toBe(true);
    expect(isValidCategory(null)).toBe(true);
    expect(isValidCategory("bistro")).toBe(false);
    expect(isValidCategory("cafe")).toBe(true);
  });

  it("blocks an invalid patch before it reaches the database", () => {
    expect(validateCandidatePatch({ veggie_classification: "vegan!" })).toBe(
      CLASSIFICATION_INVALID_MESSAGE,
    );
    expect(validateCandidatePatch({ image_rights_status: "pending" })).toBe(
      IMAGE_RIGHTS_INVALID_MESSAGE,
    );
    expect(validateCandidatePatch({ veggie_classification: "fully_vegan", category: "cafe" })).toBeNull();
    expect(validateCandidatePatch({})).toBeNull();
    // NULL classification is a legitimate draft state.
    expect(validateCandidatePatch({ veggie_classification: null })).toBeNull();
  });
});

describe("WO-108 server error mapping stays owner-safe", () => {
  it("maps the raw constraint violation to friendly copy", () => {
    const raw =
      'new row for relation "place_candidates" violates check constraint "place_candidates_veggie_classification_check"';
    const msg = mapCandidateConstraintError(raw);
    expect(msg).toBe(CLASSIFICATION_INVALID_MESSAGE);
    expect(msg).not.toMatch(/place_candidates|check constraint|23514|relation/i);
  });

  it("maps image rights and enum violations too", () => {
    expect(
      mapCandidateConstraintError(
        'violates check constraint "place_candidates_image_rights_status_check"',
      ),
    ).toBe(IMAGE_RIGHTS_INVALID_MESSAGE);
    expect(
      mapCandidateConstraintError('invalid input value for enum place_category: "bistro"'),
    ).toBe("Choose a valid category.");
  });
});

describe("WO-108 publish blocker copy", () => {
  const base = {
    id: "c1",
    google_place_id: "ChIJx",
    google_formatted_address: "1 Test St",
    latitude: 10.7,
    longitude: 106.6,
    display_name: "Test",
    category: "restaurant",
    veggie_classification: null,
    description: "A long enough original VeggieMeet description here.",
    image_rights_status: "none",
    verification_status: "draft",
  } as unknown as PlaceCandidate;

  it("asks for a classification in plain language, without token names", () => {
    const blockers = publishBlockers(base);
    expect(blockers).toContain("Choose a vegan/vegetarian classification.");
    expect(blockers.join(" ")).not.toMatch(/veggie_classification|fully_vegan/);
  });

  it("clears once a canonical classification is chosen (no lifecycle change)", () => {
    expect(publishBlockers({ ...base, veggie_classification: "fully_vegan" })).toEqual([]);
  });
});
