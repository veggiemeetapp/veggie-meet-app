import { describe, expect, it } from "vitest";
import {
  PLACE_PHOTO_LIMIT,
  PlacePhotoError,
  placePhotoMessage,
} from "./placePhotos";

describe("placePhotoMessage", () => {
  it("maps the owner authorization refusal to member-safe copy", () => {
    expect(placePhotoMessage(new Error("Not authorized"))).toMatch(/only the veggiemeet owner/i);
  });

  it("explains the photo limit with the real limit", () => {
    expect(placePhotoMessage(new Error("Photo limit reached"))).toContain(
      String(PLACE_PHOTO_LIMIT),
    );
  });

  it("explains why the cover photo cannot be reordered", () => {
    expect(placePhotoMessage(new Error("Cover photo is always first"))).toMatch(
      /cover photo always appears first/i,
    );
  });

  it("keeps a missing photo neutral", () => {
    expect(placePhotoMessage(new Error("Photo not found"))).toMatch(/no longer available/i);
  });

  it("passes through validation errors raised client-side", () => {
    expect(placePhotoMessage(new PlacePhotoError("size", "That image is too large. Max 10 MB."))).toBe(
      "That image is too large. Max 10 MB.",
    );
  });

  it("never leaks raw internals for unknown failures", () => {
    const msg = placePhotoMessage(new Error("PGRST301 jwt expired at row 42"));
    expect(msg).toBe("Something went wrong. Please try again.");
  });
});
