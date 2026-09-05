/**
 * WO-145H — post-departure activation stabilization.
 *
 * The problem WO-145G attributed but did not fix
 * ---------------------------------------------
 * When a sibling client closes during an update transaction, the fleet protocol
 * now resolves correctly and in milliseconds (WO-145G). But `SKIP_WAITING` was
 * then posted *immediately*, while the outgoing service worker could still be
 * finishing teardown-related extendable work for the closing client. In that
 * window the promotion request is latched but not honoured, the 250 ms reposts
 * do not help, and the member reaches the 20 s activation timeout — the
 * "timeout then retry" experience the founder rejected.
 *
 * The correction
 * --------------
 * A departure opens a short, bounded *stabilization* period before the single
 * `SKIP_WAITING`. Activation only starts once, for one measured quiet interval:
 *
 *   - the authoritative service-worker client set has not changed;
 *   - no departed client has reappeared;
 *   - every remaining client is still ready (no new unsaved work / mutation);
 *   - no new outgoing-worker activity is observed (pending fetch/lifecycle
 *     counts from the `UPDATE_DIAGNOSTICS` channel are unchanged).
 *
 * Any relevant change *restarts* the quiet interval rather than consuming the
 * activation timeout. The whole phase is bounded, and the no-departure path does
 * not enter it at all, so ordinary updates stay as fast as before.
 *
 * Kept dependency-injected and DOM-free so the whole policy is unit-testable.
 */

export interface StabilizationSample {
  /** Authoritative client count from the worker, or null when unavailable. */
  clients: number | null;
  /** Total outgoing-worker activity counter (pending + settled), or null. */
  activity: number | null;
  /**
   * WO-145H — requests the OUTGOING worker has started and not settled. A
   * pending request is an in-flight extendable event: promotion posted while one
   * is open was measured to be delayed by ~30 s. Quiet therefore requires zero
   * pending work, not merely an unchanged counter. `null` = not observable.
   */
  pending?: number | null;
  /** Coarse, anonymous pending counts by class, for attribution only. */
  pendingBySource?: Record<string, number>;
  /** Clients discovered for this transaction that still owe a readiness answer. */
  outstanding: number;
  /** A previously departed client reappeared on the channel. */
  reappeared: boolean;
  /** A remaining client now reports unsaved work or an active mutation. */
  dirty: boolean;
}

export interface StabilizationDeps {
  sample: () => Promise<StabilizationSample> | StabilizationSample;
  /** Consecutive quiet duration required before activation. */
  quietMs?: number;
  /** Interval between samples. */
  intervalMs?: number;
  /** Hard bound on the whole phase. */
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onTrace?: (entry: StabilizationTrace) => void;
}

export interface StabilizationTrace {
  t: number;
  event: "sample" | "restart" | "quiet" | "timeout" | "blocked";
  detail?: Record<string, string | number | boolean | null>;
}

export interface StabilizationResult {
  /**
   *  - `quiet`: the fleet and the outgoing worker were stable for the required
   *    interval — send `SKIP_WAITING` now;
   *  - `blocked`: a remaining client developed protected work, or a departed
   *    client came back and owes a fresh readiness answer — cancel safely;
   *  - `timeout`: the bound elapsed without a quiet interval. Activation still
   *    proceeds (the pre-WO-145H behaviour) but the run is recorded as noisy.
   */
  outcome: "quiet" | "blocked" | "timeout";
  /** How long the phase took. */
  elapsedMs: number;
  /** How many times the quiet interval had to restart. */
  restarts: number;
  /** Longest observed quiet run, in ms. */
  quietMs: number;
  reason?: "reappeared" | "dirty" | "outstanding";
}

/**
 * Derived from the WO-145G/WO-145H measurements: successful close-during-
 * preparation runs promoted the incoming worker within ~1.2–2.8 s of the
 * departure, and every reproduced failure posted `SKIP_WAITING` less than
 * ~250 ms after the sibling disappeared, while the outgoing worker still showed
 * changing activity counters. 600 ms of measured quiet covers the observed
 * teardown window with margin while remaining imperceptible next to the
 * activation itself.
 */
export const DEFAULT_QUIET_MS = 600;
export const DEFAULT_SAMPLE_INTERVAL_MS = 100;
export const DEFAULT_MAX_MS = 5_000;

export async function awaitStabilization(
  deps: StabilizationDeps,
): Promise<StabilizationResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const quietTarget = deps.quietMs ?? DEFAULT_QUIET_MS;
  const interval = deps.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const maxMs = deps.maxMs ?? DEFAULT_MAX_MS;

  const started = now();
  let restarts = 0;
  let quietSince = started;
  let longestQuiet = 0;
  let previous: { clients: number | null; activity: number | null } | null = null;

  const trace = (
    event: StabilizationTrace["event"],
    detail?: StabilizationTrace["detail"],
  ) => {
    try {
      deps.onTrace?.({ t: now(), event, detail });
    } catch {
      /* diagnostics must never break the update */
    }
  };

  for (;;) {
    let s: StabilizationSample;
    try {
      s = await deps.sample();
    } catch {
      s = { clients: null, activity: null, outstanding: 0, reappeared: false, dirty: false };
    }
    trace("sample", { ...s });

    if (s.dirty) {
      trace("blocked", { reason: "dirty" });
      return {
        outcome: "blocked",
        elapsedMs: now() - started,
        restarts,
        quietMs: longestQuiet,
        reason: "dirty",
      };
    }
    if (s.reappeared || s.outstanding > 0) {
      const reason = s.reappeared ? "reappeared" : "outstanding";
      trace("blocked", { reason });
      return {
        outcome: "blocked",
        elapsedMs: now() - started,
        restarts,
        quietMs: longestQuiet,
        reason,
      };
    }

    const busy = typeof s.pending === "number" && s.pending > 0;
    const changed =
      busy ||
      (previous !== null &&
        (previous.clients !== s.clients || previous.activity !== s.activity));
    previous = { clients: s.clients, activity: s.activity };

    if (changed) {
      restarts += 1;
      quietSince = now();
      trace("restart", {
        clients: s.clients,
        activity: s.activity,
        pending: s.pending ?? null,
        ...(s.pendingBySource ?? {}),
      });
    } else {
      const quiet = now() - quietSince;
      if (quiet > longestQuiet) longestQuiet = quiet;
      if (quiet >= quietTarget) {
        trace("quiet", { quietMs: quiet, restarts });
        return {
          outcome: "quiet",
          elapsedMs: now() - started,
          restarts,
          quietMs: quiet,
        };
      }
    }

    if (now() - started >= maxMs) {
      trace("timeout", { restarts, quietMs: longestQuiet });
      return {
        outcome: "timeout",
        elapsedMs: now() - started,
        restarts,
        quietMs: longestQuiet,
      };
    }
    await sleep(interval);
  }
}
