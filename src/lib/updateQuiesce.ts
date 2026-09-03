/**
 * WO-145E / WO-145F — bounded, reversible fleet-wide quiescence.
 *
 * Why this exists
 * ---------------
 * A waiting service worker is only promoted once the OUTGOING worker has no
 * extendable work left. VeggieMeet keeps long-lived backend connections open
 * (realtime chat, reactions, notification badges) and polls ordinary queries, so
 * an outgoing worker serving *any* client of the registration stayed busy and a
 * consented `SKIP_WAITING` was accepted but never settled. WO-145E mitigated
 * this for the accepting client only, which left the multi-client case a race:
 * a sibling window kept the outgoing worker busy and the accepting member sat on
 * "Updating…" until the bounded timeout.
 *
 * WO-145F makes quiescence an explicit, fleet-wide, transaction-scoped and fully
 * reversible step: every responsive client enters the quiescent state below and
 * acknowledges readiness BEFORE `SKIP_WAITING` is sent, and every client restores
 * normal behaviour if the transaction is cancelled or fails.
 *
 * What quiescing does (and deliberately does not) touch
 * ----------------------------------------------------
 *  - pauses ordinary React Query fetching and cancels in-flight queries;
 *  - stops polling / scheduled update checks (the gate below is consulted by the
 *    update watchers and by nonessential callers);
 *  - closes realtime channels and the realtime socket;
 *  - stops analytics delivery for the transition;
 *  - aborts safely abortable in-flight requests registered here;
 *  - prevents new nonessential requests from starting.
 *
 * It never signs out, never clears caches or site data, never unregisters, and
 * never touches unsaved member work or active mutations — those are what BLOCK a
 * transaction rather than something to be discarded.
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setAnalyticsDeliveryPaused } from "@/lib/analytics";

interface RealtimeLike {
  removeAllChannels?: () => unknown;
  realtime?: { disconnect?: () => unknown };
}

/** Close realtime channels and the realtime socket. Never throws. */
export function quiesceBackendConnections(client: unknown = supabase): void {
  const c = client as RealtimeLike | null;
  if (!c) return;
  try {
    c.removeAllChannels?.();
  } catch {
    /* a failed teardown must never block the member's update */
  }
  try {
    c.realtime?.disconnect?.();
  } catch {
    /* ditto */
  }
}

/* ---------- nonessential-request gate ---------- */

let quiesced = false;
let quiesceTxn: string | null = null;

/**
 * True while this client is prepared for an update transaction. Nonessential
 * callers (polling, prefetching, analytics, update checks) must not start new
 * work while this is true.
 */
export function isQuiesced(): boolean {
  return quiesced;
}

/** The transaction this client is currently prepared for (null when normal). */
export function quiescedTransaction(): string | null {
  return quiesceTxn;
}

/* ---------- abortable request registry ---------- */

const aborters = new Set<AbortController>();

/**
 * Register a safely abortable in-flight request so an update transaction can
 * cancel it instead of waiting for it. Returns an unregister function.
 */
export function registerAbortableRequest(controller: AbortController): () => void {
  aborters.add(controller);
  return () => aborters.delete(controller);
}

function abortRegisteredRequests(): number {
  let aborted = 0;
  for (const controller of [...aborters]) {
    try {
      if (!controller.signal.aborted) {
        controller.abort();
        aborted += 1;
      }
    } catch {
      /* an un-abortable controller must never block the transition */
    }
    aborters.delete(controller);
  }
  return aborted;
}

/* ---------- transaction-scoped quiescence ---------- */

export interface QuiesceReport {
  /** Transaction this report belongs to. */
  txnId: string;
  /** Queries whose fetching was paused/cancelled. */
  queriesCancelled: number;
  /** Safely abortable requests aborted. */
  requestsAborted: number;
  /** Realtime teardown attempted. */
  realtimeClosed: boolean;
  /** Analytics delivery paused. */
  analyticsPaused: boolean;
}

export interface QuiesceDeps {
  queryClient?: Pick<QueryClient, "cancelQueries" | "getQueryCache" | "isMutating">;
  realtimeClient?: unknown;
}

/**
 * Enter the quiescent state for `txnId`. Idempotent: re-entering for the same
 * transaction reports the same state without re-cancelling anything.
 */
export function beginQuiesce(txnId: string, deps: QuiesceDeps = {}): QuiesceReport {
  if (quiesced && quiesceTxn === txnId) {
    return {
      txnId,
      queriesCancelled: 0,
      requestsAborted: 0,
      realtimeClosed: true,
      analyticsPaused: true,
    };
  }

  quiesced = true;
  quiesceTxn = txnId;

  let queriesCancelled = 0;
  const qc = deps.queryClient;
  if (qc) {
    try {
      queriesCancelled = qc
        .getQueryCache()
        .getAll()
        .filter((q) => q.state.fetchStatus === "fetching").length;
    } catch {
      queriesCancelled = 0;
    }
    try {
      void qc.cancelQueries();
    } catch {
      /* cancellation is best-effort */
    }
  }

  const requestsAborted = abortRegisteredRequests();

  quiesceBackendConnections(deps.realtimeClient ?? supabase);

  setAnalyticsDeliveryPaused(true);

  return {
    txnId,
    queriesCancelled,
    requestsAborted,
    realtimeClosed: true,
    analyticsPaused: true,
  };
}

/**
 * Leave the quiescent state after a failed or cancelled transaction so the
 * current build continues normally. Idempotent, and refetches what was paused.
 */
export function endQuiesce(
  txnId: string | null,
  deps: QuiesceDeps = {},
): "restored" | "noop" {
  if (!quiesced) return "noop";
  if (txnId !== null && quiesceTxn !== null && quiesceTxn !== txnId) return "noop";

  quiesced = false;
  quiesceTxn = null;
  setAnalyticsDeliveryPaused(false);

  const qc = deps.queryClient as QueryClient | undefined;
  if (qc) {
    try {
      void qc.invalidateQueries();
    } catch {
      /* the normal query lifecycle refetches on the next trigger anyway */
    }
  }
  return "restored";
}

/** Test helper: forget all registry/gate state. */
export function resetQuiesceState(): void {
  quiesced = false;
  quiesceTxn = null;
  aborters.clear();
  setAnalyticsDeliveryPaused(false);
}
