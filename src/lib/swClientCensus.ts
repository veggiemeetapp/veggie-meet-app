/**
 * WO-145F — ask the active service worker for the browser's real client set.
 *
 * A frozen, discarded or crashed window never answers a BroadcastChannel census,
 * so the page cannot tell "no sibling exists" apart from "a sibling exists but is
 * unresponsive". `clients.matchAll()` inside the worker can, and that distinction
 * is what turns a spinner into the specific, actionable
 * "close that window, then try the update again" guidance.
 *
 * Every call is bounded: an unreachable worker resolves to `null` rather than
 * hanging the member's update.
 */

export interface ClientCensus {
  total: number;
  visible: number;
  focused: number;
}

export interface WorkerDiagnostics {
  fetchStarted: number;
  fetchSettled: number;
  bySource: Record<string, number>;
  pendingBySource: Record<string, number>;
  lifecycle: Record<string, number>;
}

interface ControllerLike {
  postMessage: (message: unknown, transfer?: unknown[]) => void;
}

export interface CensusDeps {
  controller?: ControllerLike | null;
  timeoutMs?: number;
  createChannel?: () => MessageChannel;
}

const DEFAULT_TIMEOUT_MS = 800;

function ask<T>(
  type: string,
  resultType: string,
  deps: CensusDeps,
): Promise<T | null> {
  const controller =
    deps.controller ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? (navigator.serviceWorker.controller as unknown as ControllerLike | null)
      : null);
  if (!controller) return Promise.resolve(null);

  const makeChannel =
    deps.createChannel ??
    (typeof MessageChannel !== "undefined" ? () => new MessageChannel() : null);
  if (!makeChannel) return Promise.resolve(null);

  return new Promise<T | null>((resolve) => {
    let settled = false;
    const done = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let channel: MessageChannel;
    try {
      channel = makeChannel();
    } catch {
      done(null);
      return;
    }
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (!data || data.type !== resultType) return;
      done(data as unknown as T);
    };
    setTimeout(() => done(null), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      controller.postMessage({ type }, [channel.port2]);
    } catch {
      done(null);
    }
  });
}

/** Bounded: resolves `null` when the worker cannot answer. */
export function requestClientCensus(deps: CensusDeps = {}): Promise<ClientCensus | null> {
  return ask<ClientCensus>("CLIENT_CENSUS", "CLIENT_CENSUS_RESULT", deps).then((r) =>
    r && typeof r.total === "number" ? r : null,
  );
}

/** Bounded, anonymous worker diagnostics (counts only; never URLs or bodies). */
export function requestWorkerDiagnostics(
  deps: CensusDeps = {},
): Promise<WorkerDiagnostics | null> {
  return ask<WorkerDiagnostics>("UPDATE_DIAGNOSTICS", "UPDATE_DIAGNOSTICS_RESULT", deps);
}
