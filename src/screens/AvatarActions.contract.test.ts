import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WO-143A — guards the two final avatar UX corrections at the source level so a
 * later edit cannot reintroduce them:
 *
 *  1. the onboarding photo step has no redundant "Skip for now" action — a
 *     stable platform avatar is already assigned, so "Continue with this
 *     avatar" IS the no-choice path;
 *  2. "Remove photo" is rendered only when an uploaded personal photo is the
 *     active avatar (never for assigned or selected platform avatars, and never
 *     while the avatar gallery is open).
 */
const onboarding = readFileSync(resolve(process.cwd(), "src/screens/Onboarding.tsx"), "utf8");
const editProfile = readFileSync(resolve(process.cwd(), "src/screens/EditProfile.tsx"), "utf8");

/** The onboarding photo step source only (later steps keep their own skips). */
const photoStart = onboarding.indexOf("function Photo({");
const photoStep = onboarding.slice(
  photoStart,
  onboarding.indexOf("\nfunction ", photoStart + 1),
);


describe("WO-143A onboarding avatar step actions", () => {
  it("offers exactly Upload / Choose another avatar / Continue", () => {
    expect(photoStep).toContain("Upload a photo");
    expect(photoStep).toContain("Choose another avatar");
    expect(photoStep).toContain("Continue with this avatar");
    expect(photoStep).toContain("Continue with this photo");
  });

  it("no longer renders a redundant skip action or takes an onSkip prop", () => {
    expect(photoStep).not.toContain("Skip for now");
    expect(photoStep).not.toContain("onSkip");
  });

  it("gates Remove photo on an uploaded photo and hides it behind the gallery", () => {
    expect(photoStep).toContain("{!pickerOpen && isUploadedAvatarUrl(avatarUrl) && (");
    expect(photoStep).toContain('{isUploadedAvatarUrl(avatarUrl)\n            ? "Continue with this photo"');
  });
});

describe("WO-143A Edit Profile avatar actions", () => {
  it("gates Remove photo on an uploaded photo only", () => {
    expect(editProfile).toContain("{isUploadedAvatarUrl(avatarUrl) && (");
    expect(editProfile).not.toContain("avatarUrl && !isPlatformAvatarToken(avatarUrl)");
  });

  it("keeps the shared gallery as the platform-avatar change action", () => {
    expect(editProfile).toContain("PlatformAvatarGallery");
    expect(editProfile).toContain("Choose a different avatar");
  });

  it("returns to the stable platform avatar when a photo is removed", () => {
    expect(editProfile).toContain("setAvatarUrl(platformToken)");
    expect(editProfile).toContain("chosenToken ?? assignedToken");
  });
});
