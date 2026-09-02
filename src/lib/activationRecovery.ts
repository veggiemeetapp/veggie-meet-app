/**
 * WO-145C — legacy-client activation recovery budget.
 *
 * Why this exists (measured, not assumed)
 * ---------------------------------------
 * The currently published VeggieMeet worker was generated with
 * `skipWaiting: true` + `clientsClaim: true`. The first prompt-mode worker
 * (`skipWaiting: false`) installs on that client and parks in `waiting`, which
 * is correct. What is *not* reliable is the promotion step: reproduced against
 * a byte-exact copy of the published build, a legacy client that posted
 * `SKIP_WAITING` to the waiting worker stayed at `waiting.state === "installed"`
 * indefinitely while the old worker still had a live client, so the member sat
 * on "Updating…" forever and "Try again" could not help either. The only paths
 * that ever promoted the new worker were "close every window" and "reload".
 *
 * A reload is therefore the bridge: it releases this client from the old
 * worker (letting the waiting worker activate) and, because HTML is served
 * Network First, the reloaded document is already the new build. The reload
 * budget below makes that bridge safe: at most one recovery reload per
 * deployed build per session, so a genuinely broken release can never turn
 * into a reload loop. Without usable storage we never reload at all and the
 * member keeps the visible, recoverable error state instead.
 *
 * Nothing here clears caches, auth tokens, drafts or offline data.
 */
const MARKER_KEY = "veggiemeet_activation_recovery";

export interface BudgetStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Claim the one-shot recovery reload for `buildId`.
 * Returns true only the first time it is claimed in this session, and only when
 * a working storage is available to bound retries.
 */
export function consumeActivationRecoveryBudget(
  storage: BudgetStorage | null,
  buildId: string,
): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(MARKER_KEY) === buildId) return false;
    storage.setItem(MARKER_KEY, buildId);
    return true;
  } catch {
    // Private mode / disabled storage: refuse rather than risk an unbounded loop.
    return false;
  }
}

export const ACTIVATION_RECOVERY_KEY = MARKER_KEY;
