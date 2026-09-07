/**
 * WO-145Q — authentication hydration gate.
 *
 * Physical failure this exists for
 * -------------------------------
 * On the founder's installed iPhone (recording IMG_0012.MP4) the app reloaded
 * after a consented update and then:
 *
 *   - rendered a blank white document for ~60s (the route gate returned `null`
 *     for the whole of auth initialisation), and
 *   - rendered the signed-out welcome/auth screens at 13:34:52 and 13:35:21 UTC
 *     even though the member never signed out (`getSession()` resolved with no
 *     session while the token refresh was still in flight over a cold network).
 *
 * The session restored by itself at 13:35:35 UTC. So the account was never lost:
 * the application simply *routed on an unresolved auth state*.
 *
 * Rules encoded here:
 *   1. never show the unauthenticated experience while initialisation is still
 *      running;
 *   2. never show it when a persisted session token exists and the provider has
 *      not yet had a bounded grace period to restore it;
 *   3. never show a private screen's onboarding redirect before the profile for
 *      the restored session has resolved;
 *   4. still fail open after the grace window, so a genuinely signed-out visitor
 *      reaches onboarding instead of an endless loading state.
 *
 * Nothing here reads, writes, logs or transmits token material: presence of a
 * key is the only fact consulted.
 */

export interface StorageLike {
  length?: number;
  key?: (index: number) => string | null;
  getItem: (key: string) => string | null;
}

/**
 * Bounded restore window. Derived from the recording: the real restore completed
 * ~43s after the unauthenticated render, and the whole hydration took ~65s on a
 * cold 5G start. 20s covers a normal cold restore while still guaranteeing a
 * signed-out visitor is never held for long.
 */
export const AUTH_HYDRATION_GRACE_MS = 20_000;

/** Supabase persists its session under `sb-<ref>-auth-token`. */
const AUTH_TOKEN_KEY = /^sb-.*-auth-token(\.\d+)?$/;

/** True when this device holds a persisted session for some account. */
export function hasPersistedAuthToken(...stores: (StorageLike | null | undefined)[]): boolean {
  for (const store of stores) {
    if (!store) continue;
    try {
      const length = typeof store.length === "number" ? store.length : 0;
      for (let i = 0; i < length; i += 1) {
        const key = store.key?.(i) ?? null;
        if (!key || !AUTH_TOKEN_KEY.test(key)) continue;
        const value = store.getItem(key);
        if (value) return true;
      }
    } catch {
      /* private mode / blocked storage: fall through to the next store */
    }
  }
  return false;
}

export type AuthGate =
  /** Initialisation or a credible restore is still in progress. */
  | "restoring"
  /** A session (and its profile) is resolved: private routes may render. */
  | "authenticated"
  /** Conclusively no session: the unauthenticated experience is correct. */
  | "signed-out";

export function classifyAuthGate(input: {
  /** The provider's own initialisation flag. */
  loading: boolean;
  hasSession: boolean;
  /** The profile fetch for the current session has settled (found or absent). */
  profileResolved: boolean;
  /** A persisted session token exists on this device. */
  persistedToken: boolean;
  /** The bounded restore window has elapsed. */
  graceElapsed: boolean;
}): AuthGate {
  const { loading, hasSession, profileResolved, persistedToken, graceElapsed } = input;
  if (hasSession) {
    // A session without a settled profile must not be routed on: the onboarding
    // redirect would fire for a fully onboarded member.
    if (!profileResolved && !graceElapsed) return "restoring";
    return "authenticated";
  }
  if (loading) return "restoring";
  if (persistedToken && !graceElapsed) return "restoring";
  return "signed-out";
}
