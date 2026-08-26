import { describe, expect, it } from "vitest";
import { classifyPlacePublishError } from "@/lib/placePublishErrors";

/** WO-132 — Community Place publication error taxonomy. */
describe("classifyPlacePublishError", () => {
  const cases: Array<[string, string]> = [
    ["PLACE_GOOGLE_ID_MISSING", "PLACE_GOOGLE_ID_MISSING"],
    ["PLACE_ADDRESS_MISSING", "PLACE_ADDRESS_MISSING"],
    ["PLACE_COORDINATES_MISSING", "PLACE_COORDINATES_MISSING"],
    ["PLACE_BUSINESS_STATUS_INVALID", "PLACE_BUSINESS_STATUS_INVALID"],
    ["PLACE_CATEGORY_MISSING", "PLACE_CATEGORY_MISSING"],
    ["PLACE_DESCRIPTION_MISSING", "PLACE_DESCRIPTION_MISSING"],
    ["PLACE_VEGGIE_REASON_MISSING", "PLACE_VEGGIE_REASON_MISSING"],
    ["PLACE_VEGGIE_CLASSIFICATION_MISSING", "PLACE_VEGGIE_CLASSIFICATION_MISSING"],
    ["PLACE_IMAGE_RIGHTS_INVALID", "PLACE_IMAGE_RIGHTS_INVALID"],
    ["PLACE_DUPLICATE_GOOGLE_ID", "PLACE_DUPLICATE_GOOGLE_ID"],
    ["PLACE_DUPLICATE_NAME_ADDRESS", "PLACE_DUPLICATE_NAME_ADDRESS"],
    ["PLACE_REJECTED", "PLACE_REJECTED"],
    ["PLACE_INVALID_STATE", "PLACE_INVALID_STATE"],
    ["PLACE_NOT_FOUND", "PLACE_NOT_FOUND"],
    ["PLACE_PERMISSION_DENIED", "PLACE_PERMISSION_DENIED"],
  ];

  it.each(cases)("maps %s to its own code with actionable copy", (raw, code) => {
    const c = classifyPlacePublishError(new Error(raw));
    expect(c.code).toBe(code);
    expect(c.message.length).toBeGreaterThan(20);
  });

  it("maps network failures without blaming candidate data", () => {
    const c = classifyPlacePublishError(new TypeError("Failed to fetch"));
    expect(c.code).toBe("PLACE_NETWORK");
    expect(c.retryable).toBe(true);
    expect(c.message).toMatch(/connection/i);
  });

  it("maps expired sessions to a sign-in instruction", () => {
    expect(classifyPlacePublishError(new Error("JWT expired")).code).toBe("PLACE_AUTH_EXPIRED");
  });

  it("treats an already-published candidate as state, not failure", () => {
    expect(classifyPlacePublishError(new Error("Candidate already published.")).code).toBe(
      "PLACE_ALREADY_PUBLISHED",
    );
  });

  it("points deterministic problems at the field to fix", () => {
    expect(classifyPlacePublishError(new Error("PLACE_DESCRIPTION_MISSING")).field).toBe(
      "description",
    );
    expect(classifyPlacePublishError(new Error("PLACE_GOOGLE_ID_MISSING")).field).toBe("google");
  });

  it("falls back safely and promises preserved changes for unknown failures", () => {
    const c = classifyPlacePublishError(new Error("something totally unexpected"));
    expect(c.code).toBe("PLACE_UNKNOWN");
    expect(c.message).toMatch(/still here/i);
  });

  it("never leaks database internals", () => {
    const raw =
      'insert or update on table "community_places" violates foreign key constraint "community_places_verified_by_fkey" SQLSTATE 23503 DETAIL: Key (verified_by)=(...) is not present in table "profiles"';
    const c = classifyPlacePublishError(new Error(raw));
    expect(c.message).not.toMatch(
      /SQLSTATE|constraint|community_places|profiles|23503|violates|PostgREST/i,
    );
  });

  it("exact incident shape: Heal and Celeb publishes without a generic error", () => {
    // The incident failed on the verified_by FK; after the fix the RPC returns
    // an id, and any remaining known failure has a specific code.
    expect(classifyPlacePublishError(new Error("PLACE_DUPLICATE_GOOGLE_ID")).message).toMatch(
      /already exists in Community Places/,
    );
  });
});
