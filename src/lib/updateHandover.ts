/**
 * WO-145Q (corrected) — bounded update session.
 *
 * Physical failure this exists for
 * -------------------------------
 * The founder pressed "Update now" exactly once. The waiting worker activated
 * and this client reloaded once — but the document that came back was still not
 * the published build, so the application raised the assertive
 * "This window needs to update … Reload now" state (production telemetry:
 * `app_update_build_mismatch` with `cause: remote_build_mismatch` from
 * 13:35:38 UTC onwards). One accepted update had silently degraded into a
 * second manual action.
 *
 * The honest contract (WO-145Q CORRECTION)
 * ----------------------------------------
 * One explicit "Update now" opens a BOUNDED UPDATE SESSION. That session may
 * perform **at most 2 controlled document reloads in total**:
 *
 *   reload 1 — the consent reload itself (the newly activated worker takes over);
 *   reload 2 — one automatic completion reload, used only if the document that
 *              booted from reload 1 is provably still not the published build
 *              (the genuine A → B → C intermediate-release case).
 *
 * So for an A → B → C chain the member taps once and the app performs two
 * reloads. That total is reported as two — never described as one. Beyond the
 * budget the member is asked again, so a non-converging origin can never loop.
 *
 * Safety rules that always win over automatic completion:
 *   - unsaved work or in-flight mutations → prompt, never reload;
 *   - a reload already requested by this document → do nothing;
 *   - no session on record (nobody consented) → prompt, never reload.
 *
 * Storage is one session-scoped id plus one small integer. No auth material, no
 * member data, no `unregister()`, no `clientsClaim`, no takeover.
 */

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Identifier of the open update session the member consented to. */
export const UPDATE_SESSION_KEY = "veggiemeet_update_session";
/** Total controlled document reloads this session has already performed. */
export const UPDATE_SESSION_RELOADS_KEY = "veggiemeet_update_session_reloads";
/** WO-145R — wall-clock moment the consent was given (ms since epoch). */
export const UPDATE_SESSION_STARTED_KEY = "veggiemeet_update_session_started";

/**
 * The exact maximum: the consent reload plus one automatic completion reload.
 */
export const MAX_UPDATE_SESSION_RELOADS = 2;
/** Derived, for readability at call sites: automatic reloads after the consent. */
export const MAX_AUTOMATIC_COMPLETION_RELOADS = MAX_UPDATE_SESSION_RELOADS - 1;

/**
 * WO-145R — short-lived consent boundary (defence in depth).
 *
 * An installed PWA tab can stay alive for days. A consent that never completed
 * must not remain authorized: without an expiry, a later foreground / focus /
 * reconnect check that discovers a newer build would reload the member's window
 * with no current consent. Every failure path also ends the session explicitly;
 * this bound catches anything that escaped one.
 *
 * Two minutes comfortably covers the physically observed worst case (a ~65s cold
 * hydration plus one controlled reload) and is far shorter than any plausible
 * "much later" background reload.
 */
export const UPDATE_SESSION_MAX_AGE_MS = 120_000;

function newSessionId(): string {
  try {
    return `upd-${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return "upd-session";
  }
}

/** Opens the bounded update session for one member consent. */
export function startUpdateSession(
  storage: StorageLike | null,
  id?: string,
  now: number = Date.now(),
): string {
  const sessionId = id ?? newSessionId();
  if (!storage) return sessionId;
  try {
    storage.setItem(UPDATE_SESSION_KEY, sessionId);
    storage.setItem(UPDATE_SESSION_RELOADS_KEY, "0");
    storage.setItem(UPDATE_SESSION_STARTED_KEY, String(now));
  } catch {
    /* private mode: the session degrades to the explicit prompt */
  }
  return sessionId;
}

export function updateSessionId(storage: StorageLike | null): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(UPDATE_SESSION_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Moment the open consent was given, or null when unknown. */
export function updateSessionStartedAt(storage: StorageLike | null): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(UPDATE_SESSION_STARTED_KEY);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** WO-145R — true once the consent is older than the session boundary. */
export function isUpdateSessionExpired(
  storage: StorageLike | null,
  now: number = Date.now(),
): boolean {
  if (updateSessionId(storage) === null) return false;
  const startedAt = updateSessionStartedAt(storage);
  // A session with no recorded start cannot be proven current: treat it as spent.
  if (startedAt === null) return true;
  return now - startedAt > UPDATE_SESSION_MAX_AGE_MS;
}

/**
 * A consent is only ACTIVE while it exists and is within the boundary. An
 * expired session is closed on read, so it can never arm a later reload.
 */
export function isUpdateSessionActive(
  storage: StorageLike | null,
  now: number = Date.now(),
): boolean {
  if (updateSessionId(storage) === null) return false;
  if (isUpdateSessionExpired(storage, now)) {
    endUpdateSession(storage);
    return false;
  }
  return true;
}

export function endUpdateSession(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(UPDATE_SESSION_KEY);
    storage.removeItem(UPDATE_SESSION_RELOADS_KEY);
    storage.removeItem(UPDATE_SESSION_STARTED_KEY);
  } catch {
    /* ignore */
  }
}

export function readSessionReloads(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(UPDATE_SESSION_RELOADS_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Counts one controlled document reload against the session budget. Called for
 * BOTH the consent reload and the automatic completion reload, so the number it
 * returns is the honest total for this update session.
 */
export function noteSessionReload(storage: StorageLike | null): number {
  if (!storage) return 0;
  if (!isUpdateSessionActive(storage)) return readSessionReloads(storage);
  try {
    const next = readSessionReloads(storage) + 1;
    storage.setItem(UPDATE_SESSION_RELOADS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}


export type HandoverDecision =
  /** Complete the consented session with one further controlled reload. */
  | "auto-reload"
  /** Ask the member (unsaved work, no session, or budget spent). */
  | "prompt"
  /** Nothing to do. */
  | "none";

export function classifyHandover(input: {
  /** This client is knowingly stale (`update-required`). */
  updateRequired: boolean;
  /** A bounded update session opened by a member consent is still open. */
  sessionActive: boolean;
  /** Controlled reloads already performed in this session (consent reload = 1). */
  reloadsUsed: number;
  /** Unsaved work or in-flight mutations in this client. */
  dirty: boolean;
  /** A reload has already been requested by this document. */
  reloadRequested?: boolean;
}): HandoverDecision {
  const { updateRequired, sessionActive, reloadsUsed, dirty, reloadRequested } = input;
  if (!updateRequired) return "none";
  if (reloadRequested === true) return "none";
  if (dirty) return "prompt";
  if (sessionActive && reloadsUsed < MAX_UPDATE_SESSION_RELOADS) return "auto-reload";
  return "prompt";
}
