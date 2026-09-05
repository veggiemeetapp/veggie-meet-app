/**
 * WO-145 — deterministic PWA update coordinator.
 *
 * Why this exists
 * ---------------
 * Before WO-145 the app registered a `generateSW` worker with
 * `registerType: "autoUpdate"` + unconditional `skipWaiting`, and called
 * `register()` exactly once on `load`. That combination has two failure modes
 * which together produced the reported symptom (installed PWA kept showing the
 * pre-WO-143 avatar behaviour until the member signed out and back in):
 *
 *  1. No update check ever ran after boot. An installed standalone PWA is
 *     usually *resumed*, not navigated: the document is restored from the
 *     platform's frozen page state, so no `load`, no `register()`, no
 *     `registration.update()`. The browser's own opportunistic SW check needs a
 *     navigation, so a resumed app could stay on build A indefinitely.
 *  2. When a new worker *was* found, `skipWaiting` activated it underneath a
 *     running build-A document. The already-parsed HTML/JS kept running, so the
 *     UI stayed on build A while the caches moved to build B — and lazy chunk
 *     requests could mix builds.
 *
 * Signing out "fixed" it only because the auth flow performs a full document
 * navigation (and the OAuth round-trip leaves the origin entirely), which is
 * the one thing that reliably re-boots the client onto the activated build.
 *
 * This module replaces that with an explicit lifecycle: waiting-worker
 * detection, debounced checks on launch / foreground / focus / reconnect /
 * interval / manual action, one accessible prompt per waiting build, an
 * unsaved-work guard, and exactly one reload after `controllerchange`.
 *
 * It is deliberately framework-free and fully dependency-injected so the whole
 * lifecycle is unit-testable without a real service worker.
 */

export type UpdateStatus =
  | "idle"
  | "available"
  | "activating"
  | "failed"
  /** WO-145B: a newer build activated in the fleet; this client must reload. */
  | "update-required";

export interface UpdateState {
  status: UpdateStatus;
  /** Session-scoped identity of the currently waiting build (null = none). */
  waitingToken: number | null;
  /** Waiting build the member postponed during this session. */
  dismissedToken: number | null;
  /** An update check is in flight. */
  checking: boolean;
  /** Last activation attempt was refused because of unsaved work. */
  blockedByUnsavedWork: boolean;
  /** Another VeggieMeet window/tab is open, so it will reload too. */
  otherClientsLikely: boolean;
  /** WO-145B: this client is stale and blocked from version-sensitive work. */
  updateRequired: boolean;
  /** WO-145B: number of live sibling clients seen in the last census. */
  peerCount: number;
  lastCheckAt: number | null;
}

export type UpdateTelemetryEvent =
  | "app_update_detected"
  | "app_update_prompt_shown"
  | "app_update_postponed"
  | "app_update_activation_requested"
  | "app_update_blocked_unsaved"
  | "app_update_controller_changed"
  | "app_update_reload_completed"
  | "app_update_failed"
  | "app_update_build_mismatch";

export type CheckReason =
  | "launch"
  | "visible"
  | "focus"
  | "reconnect"
  | "interval"
  | "manual";

/* ---------- Minimal structural types (real SW types are DOM-only) ---------- */

export interface WorkerLike {
  state: string;
  postMessage: (message: unknown) => void;
  addEventListener: (type: "statechange", listener: () => void) => void;
  removeEventListener?: (type: "statechange", listener: () => void) => void;
}

export interface RegistrationLike {
  installing: WorkerLike | null;
  waiting: WorkerLike | null;
  active: WorkerLike | null;
  update: () => Promise<unknown>;
  addEventListener: (type: "updatefound", listener: () => void) => void;
}

export interface ContainerLike {
  controller: WorkerLike | null;
  addEventListener: (type: "controllerchange", listener: () => void) => void;
}

export interface CoordinatorDeps {
  container: ContainerLike;
  reload: () => void;
  now: () => number;
  log: (event: UpdateTelemetryEvent, properties?: Record<string, unknown>) => void;
  /** True when reloading would destroy meaningful in-progress member work. */
  hasUnsavedWork: () => boolean;
  /** Tell sibling tabs/windows that an activation is happening. */
  broadcast?: (message: { type: "activating" }) => void;
  /**
   * WO-145F — true while this client is quiesced for an update transaction.
   * Scheduled/opportunistic update checks are nonessential requests: starting
   * one keeps the outgoing worker busy and is exactly what delayed a consented
   * activation. A manual check by the member is still honoured.
   */
  isPaused?: () => boolean;
  /**
   * WO-145F — the new build is genuinely active and this client is about to
   * reload. Measured against real builds: broadcasting the commit BEFORE
   * activation makes every sibling navigate through the still-outgoing worker,
   * which keeps that worker busy and prevented the promotion the member asked
   * for. Siblings are therefore told only once activation has landed.
   */
  onActivated?: (cause: string) => void;



  minCheckIntervalMs?: number;
  activationTimeoutMs?: number;
}

const DEFAULT_MIN_CHECK_INTERVAL_MS = 60_000;
/**
 * WO-145D: how long a posted SKIP_WAITING is given before the client reports a
 * recoverable failure.
 *
 * Measured in Chromium against the real production builds: promotion normally
 * completes in ~250ms, but a document with in-flight requests still outstanding
 * (authenticated backend reads, a retrying request) can hold the outgoing worker
 * busy for several seconds — promotion then lands as soon as those settle. A
 * 2.5s budget reported a false failure in exactly that case, so the budget is
 * bounded but generous, and SKIP_WAITING is re-posted on every poll tick because
 * the message is one-shot and may be observed while the worker is still busy.
 *
 * A stall past the budget is surfaced as a visible, retryable error with the
 * current build left working — never an unregister, and never a reload of a
 * client whose activation is still pending (measured in WO-145C to hang the
 * navigation).
 */
const DEFAULT_ACTIVATION_TIMEOUT_MS = 20_000;
/** How often the pending activation is re-checked against the registration. */
const ACTIVATION_POLL_MS = 250;






export const SKIP_WAITING_MESSAGE = { type: "SKIP_WAITING" } as const;

/**
 * One coordinator per client. `waitingToken` increments each time a *distinct*
 * waiting worker is observed, which is what makes "one prompt per build per
 * session" enforceable without exposing any build secret to the page.
 */
export class UpdateCoordinator {
  private deps: CoordinatorDeps;
  private registration: RegistrationLike | null = null;
  private listeners = new Set<() => void>();
  private tokenSeq = 0;
  private trackedWaiting: WorkerLike | null = null;
  private reloaded = false;
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private activationPoll: ReturnType<typeof setInterval> | null = null;
  /** WO-145H — bounded nudge counter for the activation poll. */
  private activationTicks = 0;

  private promptLoggedToken: number | null = null;

  private state: UpdateState = {
    status: "idle",
    waitingToken: null,
    dismissedToken: null,
    checking: false,
    blockedByUnsavedWork: false,
    otherClientsLikely: false,
    updateRequired: false,
    peerCount: 0,
    lastCheckAt: null,
  };

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
    this.deps.container.addEventListener("controllerchange", () =>
      this.onControllerChange(),
    );
  }

  /* ---------- store ---------- */

  getState = (): UpdateState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /* ---------- registration wiring ---------- */

  attach(registration: RegistrationLike): void {
    this.registration = registration;
    registration.addEventListener("updatefound", () => this.scanForWaiting());
    this.scanForWaiting();
  }

  /**
   * A worker only becomes a *usable* update once it reaches `installed` while
   * this client already has a controller. Installing the very first worker is
   * not an update and must never prompt.
   */
  private scanForWaiting(): void {
    const reg = this.registration;
    if (!reg) return;

    const candidate = reg.waiting ?? reg.installing ?? null;
    if (!candidate) return;
    if (!this.deps.container.controller) return; // first install, not an update

    if (candidate.state === "installed") {
      this.markWaiting(candidate);
      return;
    }
    const onStateChange = () => {
      if (candidate.state === "installed") this.markWaiting(candidate);
    };
    candidate.addEventListener("statechange", onStateChange);
  }

  private markWaiting(worker: WorkerLike): void {
    if (this.trackedWaiting === worker) return;
    this.trackedWaiting = worker;
    this.tokenSeq += 1;
    this.deps.log("app_update_detected", { reason: "waiting_worker" });
    this.set({
      status: "available",
      waitingToken: this.tokenSeq,
      // A newly detected build clears an earlier postponement.
      dismissedToken: null,
      blockedByUnsavedWork: false,
    });
  }

  /** True when the accessible prompt should be visible right now. */
  shouldPrompt(): boolean {
    const s = this.state;
    if (
      s.status === "activating" ||
      s.status === "failed" ||
      s.status === "update-required"
    )
      return true;
    return (
      s.status === "available" &&
      s.waitingToken !== null &&
      s.waitingToken !== s.dismissedToken
    );
  }

  /** Called by the UI when the prompt becomes visible (one event per build). */
  notePromptShown(): void {
    const token = this.state.waitingToken;
    if (token === null || this.promptLoggedToken === token) return;
    this.promptLoggedToken = token;
    this.deps.log("app_update_prompt_shown", {});
  }

  noteOtherClients(present: boolean): void {
    if (this.state.otherClientsLikely !== present)
      this.set({ otherClientsLikely: present });
  }

  /* ---------- checks ---------- */

  async checkForUpdate(reason: CheckReason): Promise<boolean> {
    const reg = this.registration;
    if (!reg) return false;
    if (this.state.checking) return false;
    if (reason !== "manual" && this.deps.isPaused?.() === true) return false;

    const min = this.deps.minCheckIntervalMs ?? DEFAULT_MIN_CHECK_INTERVAL_MS;
    const last = this.state.lastCheckAt;
    if (reason !== "manual" && last !== null && this.deps.now() - last < min)
      return false;

    this.set({ checking: true, lastCheckAt: this.deps.now() });
    try {
      await reg.update();
      this.scanForWaiting();
      return true;
    } catch {
      // A failed check is never fatal: the current build keeps working and the
      // next trigger retries. Offline checks land here routinely.
      return false;
    } finally {
      this.set({ checking: false });
    }
  }

  /* ---------- activation ---------- */

  /** Member chose "Later" — suppress the prompt for this waiting build only. */
  dismiss(): void {
    if (this.state.waitingToken === null) return;
    this.deps.log("app_update_postponed", {});
    this.set({
      dismissedToken: this.state.waitingToken,
      status: "available",
      blockedByUnsavedWork: false,
    });
  }

  /**
   * Member chose "Update now".
   * Returns "blocked" when unsaved work exists — the caller shows the warning
   * and nothing is activated or reloaded.
   */
  applyUpdate(options: { force?: boolean } = {}): "activating" | "blocked" | "noop" {
    // WO-145E: always address the registration's *current* waiting worker. The
    // reference captured while the worker was still `installing` is not a
    // reliable postMessage target in Chromium — measured against real builds,
    // SKIP_WAITING posted to that reference was accepted but never promoted the
    // worker, while the same message posted to `registration.waiting` promoted
    // in ~500ms.
    const waiting = this.registration?.waiting ?? this.trackedWaiting;
    if (!waiting) return "noop";


    if (!options.force && this.deps.hasUnsavedWork()) {
      this.deps.log("app_update_blocked_unsaved", {});
      this.set({ blockedByUnsavedWork: true });
      return "blocked";
    }

    this.deps.log("app_update_activation_requested", {
      forced: options.force === true,
    });
    this.set({ status: "activating", blockedByUnsavedWork: false });
    this.deps.broadcast?.({ type: "activating" });

    // WO-145B: with `clientsClaim: false` the new worker activates without
    // claiming this document, so `controllerchange` may never fire. The
    // authoritative signal is the waiting worker reaching `activated`; a
    // reload then boots this client wholly onto the new build.
    const onActivated = () => {
      if (waiting.state === "activated" || waiting.state === "redundant")
        this.finishActivation("worker_activated");
    };
    try {
      waiting.addEventListener("statechange", onActivated);
    } catch {
      /* structural worker without listeners (tests) */
    }

    try {
      waiting.postMessage(SKIP_WAITING_MESSAGE);
    } catch {
      this.fail("post_message_failed");
      return "activating";
    }
    onActivated();

    // WO-145C: the `statechange` event alone proved unreliable in a real
    // Chromium run — promotion happened while no event was observed on this
    // reference, so the client sat on "Updating…" until the fallback fired.
    // Polling the registration is the authoritative check: once this worker is
    // no longer the registration's `waiting` worker, the new build is active and
    // the client may reload immediately. The bounded timeout below reports a
    // retryable failure for a worker that genuinely refuses to hand over.
    this.activationTicks = 0;
    this.activationPoll = setInterval(() => {
      if (this.state.status !== "activating") {
        this.clearActivationPoll();
        return;
      }
      const reg = this.registration;
      const promoted =
        waiting.state === "activated" ||
        waiting.state === "redundant" ||
        (reg !== null && reg.waiting !== waiting);
      if (promoted) {
        this.finishActivation("worker_activated");
        return;
      }
      // WO-145E: `SKIP_WAITING` is one-shot and can be observed while the
      // outgoing worker is still finishing work, in which case the promotion
      // does not land. Re-posting on each tick is idempotent (`skipWaiting()`
      // is latched) and promotion lands the moment the outgoing worker is free.
      try {
        waiting.postMessage(SKIP_WAITING_MESSAGE);
      } catch {
        /* the worker went away; the promotion checks above settle this */
      }
      // WO-145H — measured on genuine builds: after a sibling window closes the
      // outgoing worker can sit idle (no pending fetch, no clients but this one)
      // and Chromium still deferred promotion for ~30s. Re-running the update
      // algorithm re-evaluates the registration and lets the promotion land. It
      // is non-destructive (never `unregister()`), idempotent and bounded to a
      // couple of nudges so it can never become a loop.
      this.activationTicks += 1;
      if (this.activationTicks === 8 || this.activationTicks === 20) {
        try {
          void this.registration?.update?.();
        } catch {
          /* an unavailable update() simply means we keep polling */
        }
      }
    }, ACTIVATION_POLL_MS);





    const timeout = this.deps.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
    this.activationTimer = setTimeout(() => {
      this.activationTimer = null;
      if (this.state.status !== "activating") return;
      // WO-145E: no registration-removal fallback exists on this path, and no
      // migration bridge ships. A stall here is a genuine failure and is
      // surfaced as a retryable error with the current build left working.
      this.fail("controller_timeout");
    }, timeout);

    return "activating";
  }


  /**
   * WO-145B — the fleet leader activated a new build. Every other client must
   * converge exactly once: reload immediately when it is safe, otherwise enter
   * a visible `update-required` state that blocks version-sensitive work until
   * the member saves or discards.
   */
  noteFleetCommit(info: { forced: boolean }): void {
    if (this.reloaded) return;
    // WO-145E: the client that asked for the activation is already running the
    // activation lifecycle. Reloading it here (its own commit broadcast comes
    // back to it) starts a navigation while `skipWaiting()` is still pending,
    // which Chromium cannot complete — the document never unloads, the worker
    // never activates, and the member is stranded on "Updating…". Measured
    // repeatedly in WO-145E: this was the sole cause of the stalled consented
    // update. Let the activation path finish and reload exactly once.
    if (this.state.status === "activating") return;
    if (info.forced || !this.deps.hasUnsavedWork()) {
      this.finishActivation("fleet_commit");
      return;
    }
    this.deps.log("app_update_blocked_unsaved", { phase: "fleet_commit" });
    this.set({ status: "update-required", updateRequired: true });
  }


  /**
   * Called when protected work is saved/discarded, or by the member from the
   * update-required prompt. Reloads at most once, never in a loop.
   */
  reloadIfSafe(options: { force?: boolean } = {}): "reloaded" | "blocked" | "noop" {
    if (!this.state.updateRequired && this.state.status !== "update-required")
      return "noop";
    if (!options.force && this.deps.hasUnsavedWork()) {
      this.set({ blockedByUnsavedWork: true });
      return "blocked";
    }
    this.finishActivation("update_required_resolved");
    return "reloaded";
  }

  /**
   * True while this client is knowingly running an old build under a newer
   * deployment: version-sensitive operations (lazy chunk imports, writes that
   * depend on the new contract) must be withheld until it reloads.
   */
  isVersionSensitiveBlocked(): boolean {
    return this.state.updateRequired;
  }

  /** Mark this client as stale without a worker signal (chunk-load failure). */
  enterUpdateRequired(cause: string): void {
    if (this.state.updateRequired || this.reloaded) return;
    this.deps.log("app_update_build_mismatch", { cause });
    this.set({ status: "update-required", updateRequired: true });
  }

  /** Reload exactly once for this client, for any activation path. */


  private clearActivationPoll(): void {
    if (this.activationPoll !== null) {
      clearInterval(this.activationPoll);
      this.activationPoll = null;
    }
  }

  private finishActivation(cause: string): void {
    this.clearActivationPoll();
    if (this.activationTimer !== null) {
      clearTimeout(this.activationTimer);
      this.activationTimer = null;
    }
    if (this.reloaded) return;
    this.reloaded = true;
    this.deps.log("app_update_reload_completed", { cause });
    // Activation has landed: siblings may now converge onto the new build. This
    // ordering is what makes the multi-client transition deterministic.
    try {
      this.deps.onActivated?.(cause);
    } catch {
      /* a sibling notification must never block this client's reload */
    }
    this.deps.reload();
  }



  private fail(cause: string): void {
    this.clearActivationPoll();
    this.deps.log("app_update_failed", { cause });
    this.set({ status: "failed" });
  }


  /** Retry after a failed activation, without a second prompt cycle. */
  retry(): "activating" | "blocked" | "noop" {
    if (this.state.status !== "failed") return "noop";
    this.set({ status: "available" });
    return this.applyUpdate({ force: true });
  }

  /**
   * The new worker now controls this client. Reload exactly once, and only for
   * an activation this client asked for — a sibling tab's activation must not
   * yank a member out of a form mid-edit.
   */
  private onControllerChange(): void {
    this.deps.log("app_update_controller_changed", {});
    // Only an activation THIS client asked for may reload it. A sibling tab's
    // activation is handled through the fleet protocol instead, so a member is
    // never yanked out of a form mid-edit.
    if (this.state.status !== "activating") return;
    this.finishActivation("controller_changed");
  }

  /** WO-145B: record the live sibling count from the last fleet census. */
  notePeerCount(count: number): void {
    if (this.state.peerCount !== count)
      this.set({ peerCount: count, otherClientsLikely: count > 0 });
  }

  /** Test/inspection helper. */
  hasWaitingWorker(): boolean {
    return this.trackedWaiting !== null;
  }
}

/* ---------- watchers ---------- */

export interface WatcherTargets {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface WatcherOptions {
  win: WatcherTargets;
  doc: { visibilityState: string } & WatcherTargets;
  intervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export const DEFAULT_POLL_INTERVAL_MS = 30 * 60_000;

/**
 * Attach every update trigger the WO requires. The coordinator itself owns
 * debouncing, so duplicate triggers (focus + visible fire together on iOS
 * resume) collapse into a single `registration.update()`.
 */
export function startUpdateWatchers(
  coordinator: UpdateCoordinator,
  options: WatcherOptions,
): () => void {
  const { win, doc } = options;
  const setIntervalFn = options.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn =
    options.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  const onVisible = () => {
    if (doc.visibilityState === "visible") void coordinator.checkForUpdate("visible");
  };
  const onFocus = () => void coordinator.checkForUpdate("focus");
  const onOnline = () => void coordinator.checkForUpdate("reconnect");

  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("focus", onFocus);
  win.addEventListener("online", onOnline);
  // iOS standalone restores frozen documents: pageshow is the resume signal
  // that fires when neither load nor visibilitychange does.
  win.addEventListener("pageshow", onVisible);

  const handle = setIntervalFn(
    () => void coordinator.checkForUpdate("interval"),
    options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );

  return () => {
    doc.removeEventListener("visibilitychange", onVisible);
    win.removeEventListener("focus", onFocus);
    win.removeEventListener("online", onOnline);
    win.removeEventListener("pageshow", onVisible);
    clearIntervalFn(handle);
  };
}
