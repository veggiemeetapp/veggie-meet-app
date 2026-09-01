/**
 * WO-143 — single source of truth for member avatar resolution.
 *
 * Every VeggieMeet member always has an avatar. There are exactly two normal
 * representations stored in `profiles.avatar_url`:
 *
 *  1. a hosted `https://` image the member uploaded themselves;
 *  2. a VeggieMeet platform-avatar token of the form `veggiemeet:avatar-NN`
 *     that points at one of the bundled approved cartoon assets below.
 *
 * The token (not a URL) is stored so the assignment is stable forever: it is
 * device independent, survives refreshes/sessions, works offline, and never
 * depends on a third-party image host. Tokens are assigned server-side and
 * derived deterministically from the profile's immutable id, so a member never
 * has to make an avatar choice to finish onboarding.
 *
 * The initial-letter fallback is gone. If an image genuinely fails to load we
 * fall back to the member's stable platform avatar, and only if that also
 * fails to a neutral (never initial-bearing) placeholder mark.
 */

import a01 from "@/assets/avatars/veggie-avatar-01.jpg";
import a02 from "@/assets/avatars/veggie-avatar-02.jpg";
import a03 from "@/assets/avatars/veggie-avatar-03.jpg";
import a04 from "@/assets/avatars/veggie-avatar-04.jpg";
import a05 from "@/assets/avatars/veggie-avatar-05.jpg";
import a06 from "@/assets/avatars/veggie-avatar-06.jpg";
import a07 from "@/assets/avatars/veggie-avatar-07.jpg";
import a08 from "@/assets/avatars/veggie-avatar-08.jpg";

/** Approved VeggieMeet cartoon avatar assets, index 1..N by position. */
export const PLATFORM_AVATARS: readonly string[] = [a01, a02, a03, a04, a05, a06, a07, a08];

export const PLATFORM_AVATAR_COUNT = PLATFORM_AVATARS.length;

/** `veggiemeet:avatar-03` — mirrored by `public.is_safe_avatar_url` server-side. */
export const PLATFORM_AVATAR_TOKEN_RE = /^veggiemeet:avatar-(\d{2})$/;

export function isPlatformAvatarToken(value: string | null | undefined): boolean {
  return !!value && PLATFORM_AVATAR_TOKEN_RE.test(value);
}

export function isUploadedAvatarUrl(value: string | null | undefined): boolean {
  return !!value && /^https:\/\//i.test(value);
}

/** Build the token for a 1-based index (wraps into range). */
export function platformAvatarToken(index: number): string {
  const n = ((Math.abs(Math.trunc(index)) - 1) % PLATFORM_AVATAR_COUNT) + 1;
  return `veggiemeet:avatar-${String(n).padStart(2, "0")}`;
}

/**
 * Deterministic 32-bit FNV-1a hash. Same algorithm shape as the server-side
 * assignment: identical seed always maps to the identical avatar.
 */
export function avatarSeedIndex(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % PLATFORM_AVATAR_COUNT) + 1;
}

/** Stable platform-avatar token for a member seed (profile id preferred). */
export function platformAvatarTokenForSeed(seed: string | null | undefined): string {
  return platformAvatarToken(avatarSeedIndex(seed && seed.length ? seed : "veggiemeet"));
}

/** Resolve a stored token to a bundled asset URL. */
export function platformAvatarAsset(token: string): string {
  const m = PLATFORM_AVATAR_TOKEN_RE.exec(token);
  const idx = m ? Number(m[1]) : 1;
  return PLATFORM_AVATARS[((idx - 1) % PLATFORM_AVATAR_COUNT + PLATFORM_AVATAR_COUNT) % PLATFORM_AVATAR_COUNT];
}

export interface ResolvedAvatar {
  /** Image URL to render — always defined. */
  src: string;
  /** True when the resolved image is a platform cartoon avatar. */
  isPlatform: boolean;
  /** Stable platform asset to use if `src` fails to load. */
  fallbackSrc: string;
}

/**
 * Resolve any stored avatar value into something renderable.
 *
 * `seed` should be the most stable identifier available (profile id); the
 * display name is an acceptable last resort for surfaces that only carry a
 * name. Missing, empty and invalid values all resolve to a stable platform
 * avatar — never to an initial.
 */
export function resolveAvatar(
  stored: string | null | undefined,
  seed: string | null | undefined,
): ResolvedAvatar {
  const value = (stored ?? "").trim();
  const fallbackSrc = platformAvatarAsset(platformAvatarTokenForSeed(seed));
  if (isPlatformAvatarToken(value)) {
    return { src: platformAvatarAsset(value), isPlatform: true, fallbackSrc };
  }
  if (isUploadedAvatarUrl(value)) {
    return { src: value, isPlatform: false, fallbackSrc };
  }
  return { src: fallbackSrc, isPlatform: true, fallbackSrc };
}
