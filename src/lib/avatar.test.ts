import { describe, it, expect } from "vitest";
import {
  PLATFORM_AVATAR_COUNT,
  isPlatformAvatarToken,
  platformAvatarToken,
  platformAvatarTokenForSeed,
  resolveAvatar,
} from "./avatar";

describe("WO-143 avatar resolution", () => {
  it("builds zero-padded tokens inside the asset range", () => {
    expect(platformAvatarToken(1)).toBe("veggiemeet:avatar-01");
    expect(platformAvatarToken(PLATFORM_AVATAR_COUNT)).toBe(
      `veggiemeet:avatar-0${PLATFORM_AVATAR_COUNT}`,
    );
    expect(isPlatformAvatarToken(platformAvatarToken(PLATFORM_AVATAR_COUNT + 1))).toBe(true);
  });

  it("is deterministic for the same seed and never empty", () => {
    const a = platformAvatarTokenForSeed("f18c2a90-4ecd-4b50-b0db-01520e9e81b4");
    const b = platformAvatarTokenForSeed("f18c2a90-4ecd-4b50-b0db-01520e9e81b4");
    expect(a).toBe(b);
    expect(isPlatformAvatarToken(platformAvatarTokenForSeed(null))).toBe(true);
    expect(isPlatformAvatarToken(platformAvatarTokenForSeed(""))).toBe(true);
  });

  it("resolves missing, empty and invalid values to a platform avatar", () => {
    for (const stored of [null, undefined, "", "   ", "not-a-url", "http://insecure/x.png"]) {
      const r = resolveAvatar(stored, "seed-1");
      expect(r.isPlatform).toBe(true);
      expect(r.src).toBeTruthy();
      expect(r.src).toBe(r.fallbackSrc);
    }
  });

  it("keeps uploaded https photos and offers a platform fallback", () => {
    const url = "https://example.supabase.co/storage/v1/object/sign/avatars/x.jpg";
    const r = resolveAvatar(url, "seed-1");
    expect(r.src).toBe(url);
    expect(r.isPlatform).toBe(false);
    expect(r.fallbackSrc).toBe(resolveAvatar(null, "seed-1").src);
  });

  it("resolves tokens to distinct bundled assets", () => {
    const assets = new Set(
      Array.from({ length: PLATFORM_AVATAR_COUNT }, (_, i) =>
        resolveAvatar(platformAvatarToken(i + 1), "x").src,
      ),
    );
    expect(assets.size).toBe(PLATFORM_AVATAR_COUNT);
  });
});
