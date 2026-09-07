/**
 * WO-145Q (corrected) — authentication restoration gate.
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
 * Corrected contract (WO-145Q CORRECTION)
 * ---------------------------------------
 * Restoration NEVER fails open to onboarding. Precisely:
 *
 *   1. an explicit sign-out is immediately conclusive → `signed-out`;
 *   2. a conclusively settled no-session result with NO persisted session →
 *      `signed-out` (a genuine visitor reaches onboarding at once);
 *   3. a persisted session whose refresh / settlement / profile read is still
 *      unresolved is `restoring`, and after the bounded grace window becomes
 *      `delayed` — an honest branded state with retry and offline guidance. It
 *      never becomes `signed-out` merely because time passed;
 *   4. a restored session renders private routes once its profile has settled
 *      (or, after the grace window, without it — the member is signed in and
 *      must not be held hostage by one failed read).
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
 * Bounded window before restoration is reported as *delayed*. Derived from the
 * recording: the real restore completed ~43s after the unauthenticated render,
 * and the whole hydration took ~65s on a cold 5G start. 20s is long enough that
 * a normal cold restore never shows the delayed copy, and short enough that a
 * genuinely stuck restore explains itself instead of spinning silently.
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
  /**
   * A persisted session is still unresolved after the bounded window. The member
   * sees an honest branded delayed-restoration state with retry/offline
   * guidance. Member data is untouched and onboarding is NEVER rendered.
   */
  | "delayed"
  /** A session (and its profile) is resolved: private routes may render. */
  | "authenticated"
  /** Conclusively no session: the unauthenticated experience is correct. */
  | "signed-out";

/** True while authentication is unresolved — onboarding must not render. */
export function isRestoringGate(gate: AuthGate): boolean {
  return gate === "restoring" || gate === "delayed";
}

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
  /** The member signed out in this document — immediately conclusive. */
  explicitSignOut?: boolean;
}): AuthGate {
  const {
    loading,
    hasSession,
    profileResolved,
    persistedToken,
    graceElapsed,
    explicitSignOut,
  } = input;

  // 1. Explicit sign-out is conclusive at once.
  if (explicitSignOut === true) return "signed-out";

  if (hasSession) {
    // A session without a settled profile must not be routed on: the onboarding
    // redirect would fire for a fully onboarded member. After the window the
    // member is still signed in, so they enter the app rather than onboarding.
    if (!profileResolved && !graceElapsed) return "restoring";
    return "authenticated";
  }

  // 3. A persisted session that has not resolved is never treated as absent.
  if (persistedToken) return graceElapsed ? "delayed" : "restoring";

  // 2. Conclusively settled with nothing persisted → the visitor onboards.
  if (loading) return "restoring";
  return "signed-out";
}
