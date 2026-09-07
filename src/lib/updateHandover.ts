/**
 * WO-145Q — consent-carried document handover.
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
 * The correction is *not* an unconsented reload loop. The member's single
 * consent covers the whole handover transaction, so:
 *
 *   - consent is recorded (session-scoped) immediately before the update reload;
 *   - if the document that boots from that reload is still provably stale, the
 *     recorded consent is CONSUMED to complete the handover automatically —
 *     at most once, so a non-converging origin can never loop;
 *   - unsaved work always wins: the prompt is shown instead;
 *   - once the client is proven current, the marker is cleared.
 *
 * Two integer/flag counters only. No auth material, no member data, no
 * unregister(), no clientsClaim, no takeover.
 */

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** The member consented to an update whose handover is not yet complete. */
export const HANDOVER_CONSENT_KEY = "veggiemeet_update_consent";
/** How many automatic handover reloads that consent has already paid for. */
export const HANDOVER_RELOADS_KEY = "veggiemeet_update_handover_reloads";

/** One automatic completion per consent. Never more. */
export const MAX_HANDOVER_AUTO_RELOADS = 1;

export function recordConsent(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.setItem(HANDOVER_CONSENT_KEY, "1");
    storage.removeItem(HANDOVER_RELOADS_KEY);
  } catch {
    /* private mode: handover simply degrades to the explicit prompt */
  }
}

export function hasConsent(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(HANDOVER_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearConsent(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(HANDOVER_CONSENT_KEY);
    storage.removeItem(HANDOVER_RELOADS_KEY);
  } catch {
    /* ignore */
  }
}

export function readAutoReloads(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(HANDOVER_RELOADS_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Records the automatic reload and consumes the consent that paid for it. */
export function noteAutoReload(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const next = readAutoReloads(storage) + 1;
    storage.setItem(HANDOVER_RELOADS_KEY, String(next));
    storage.removeItem(HANDOVER_CONSENT_KEY);
    return next;
  } catch {
    return 0;
  }
}

export type HandoverDecision =
  /** Complete the handover the member already approved. */
  | "auto-reload"
  /** Ask explicitly (no consent on record, budget spent, or work in progress). */
  | "prompt"
  /** Nothing to do. */
  | "none";

export function classifyHandover(input: {
  /** This client is knowingly stale (`update-required`). */
  updateRequired: boolean;
  consented: boolean;
  autoReloads: number;
  /** Unsaved work or in-flight mutations in this client. */
  dirty: boolean;
  /** A reload has already been requested by this document. */
  reloadRequested?: boolean;
}): HandoverDecision {
  const { updateRequired, consented, autoReloads, dirty, reloadRequested } = input;
  if (!updateRequired) return "none";
  if (reloadRequested === true) return "none";
  if (dirty) return "prompt";
  if (consented && autoReloads < MAX_HANDOVER_AUTO_RELOADS) return "auto-reload";
  return "prompt";
}
