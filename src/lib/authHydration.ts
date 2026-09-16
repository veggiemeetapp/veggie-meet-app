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

/**
 * A fresh OAuth callback has no persisted Supabase token until the provider
 * response is exchanged. Give that exchange a bounded window of its own.
 */
export const OAUTH_CALLBACK_GRACE_MS = 60_000;

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
  /** A same-tab OAuth provider round trip is returning with a new session. */
  oauthPending?: boolean;
  /** The bounded restore window has elapsed. */
  graceElapsed: boolean;
  /** The member signed out in this document — immediately conclusive. */
  explicitSignOut?: boolean;
  /**
   * The profile read for the current session FAILED (offline / transient), so the
   * member's onboarding state is unknown. It must never be read as "new member":
   * that renders the welcome screen to a fully onboarded member.
   */
  profileUnavailable?: boolean;
  /**
   * WO-145R — the persisted session was CONCLUSIVELY rejected or removed by the
   * server (expired / revoked refresh token, a real SIGNED_OUT event, or storage
   * that no longer holds a session). This is a settled negative result, not an
   * inconclusive one: a timeout, offline condition or 5xx must NEVER set it.
   */
  sessionRejected?: boolean;
}): AuthGate {
  const {
    loading,
    hasSession,
    profileResolved,
    persistedToken,
    oauthPending,
    graceElapsed,
    explicitSignOut,
    profileUnavailable,
    sessionRejected,
  } = input;

  // 1. Explicit sign-out is conclusive at once.
  if (explicitSignOut === true) return "signed-out";

  if (hasSession) {
    // The profile could not be read at all: the member stays on an honest,
    // retryable restoration state rather than being offered onboarding.
    if (profileUnavailable) return graceElapsed ? "delayed" : "restoring";
    // A session without a settled profile must not be routed on: the onboarding
    // redirect would fire for a fully onboarded member. After the window the
    // member is still signed in, so they enter the app rather than onboarding.
    if (!profileResolved && !graceElapsed) return "restoring";
    return "authenticated";
  }

  // A new OAuth login does not have a persisted token yet. Treating this brief
  // exchange window as signed-out makes `/` bounce through `/onboarding` before
  // Supabase emits SIGNED_IN. Hold the protected route until it settles.
  if (oauthPending === true) return "restoring";

  // 2. WO-145R — a conclusively rejected/removed session is settled: the normal
  // signed-out experience must be reachable, whatever storage still contains.
  // An expired or revoked session is routine and must never trap the member on
  // the restoration screen.
  if (sessionRejected === true) return "signed-out";

  // 3. A persisted session whose restoration is still INCONCLUSIVE (in flight,
  // offline, 5xx, timed out) is never treated as absent.
  if (persistedToken) return graceElapsed ? "delayed" : "restoring";

  // 4. Conclusively settled with nothing persisted → the visitor onboards.
  if (loading) return "restoring";
  return "signed-out";
}
