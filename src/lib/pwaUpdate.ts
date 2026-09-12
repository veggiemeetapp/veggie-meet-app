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
import { MAX_CONVERGENCE_HOPS } from "@/lib/updateConvergence";

export type UpdateStatus =
  | "idle"
  | "available"
  | "activating"
  | "failed"
  /**
   * WO-145I — SKIP_WAITING has been sent and the browser has not activated the
   * new worker within the generously bounded evidence-based interval. This is an
   * environmental latency condition, never an application failure: the current
   * screen keeps working and the transition completes on activation or on the
   * next full close/reopen.
   */
  | "pending-close"
  /** WO-145B: a newer build activated in the fleet; this client must reload. */
  | "update-required";

/** WO-145I — progressive, non-alarming member-facing activation phase. */
export type ActivationPhase = "normal" | "slow" | "very-slow";

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
  /** WO-145I: how long the pending activation has been running, in phases. */
  activationPhase: ActivationPhase;
  /**
   * WO-145I: SKIP_WAITING has been sent for this session. The transition is
   * irreversible: no new member work may start, and any later activation is
   * honoured (immediately when safe, otherwise with explicit approval).
   */
  activationPending: boolean;
  /**
   * WO-145I: the reload for this transition has been requested. The browser may
   * hold the navigation until the incoming worker finishes activating, so the
   * update surface stays truthful instead of offering a cancel that cannot work.
   */
  reloadRequested: boolean;
  lastCheckAt: number | null;
  /**
   * WO-145O — the honest, evidence-backed result of the most recent check.
   * `null` = no check has completed in this session. Only "latest" may ever be
   * presented as "You're on the latest version": it requires BOTH a successful
   * registration update and a freshly fetched remote build id equal to the
   * running one, with no installing/waiting worker.
   */
  lastCheckOutcome: CheckOutcome | null;
  /** WO-145O — the build the origin served on the last successful check. */
  remoteBuildId: string | null;
  /**
   * WO-145P — this document booted from an update reload and the origin STILL
   * serves a newer build: the browser promoted an intermediate waiting worker.
   * The member is told one more update remains, never that this is the latest.
   */
  chainedUpdate: boolean;
  /**
   * WO-145P — the bounded hop budget is exhausted and the client is still behind
   * the published build. Reported honestly; the member is never asked to keep
   * pressing "Check for updates".
   */
  convergenceStalled: boolean;
}

/** WO-145O — outcome of a single update check. */
export type CheckOutcome = "latest" | "update-available" | "failed";



export type UpdateTelemetryEvent =
  | "app_update_detected"
  | "app_update_prompt_shown"
  | "app_update_postponed"
  | "app_update_activation_requested"
  | "app_update_activation_slow"
  | "app_update_activation_pending_close"
  | "app_update_activation_deferred"
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

export interface AutomaticUpdateInput {
  state: Pick<
    UpdateState,
    | "status"
    | "waitingToken"
    | "updateRequired"
    | "activationPending"
    | "reloadRequested"
    | "convergenceStalled"
  >;
  documentVisible: boolean;
  protectedWork: boolean;
  activeMutations: number;
  coordinating: boolean;
  transactionOpen: boolean;
}

/**
 * A published build may activate automatically only when doing so cannot erase
 * member work. Keeping this policy pure makes the no-data-loss boundary easy to
 * verify independently from the browser service-worker lifecycle.
 */
export function shouldApplyUpdateAutomatically(input: AutomaticUpdateInput): boolean {
  const {
    state,
    documentVisible,
    protectedWork,
    activeMutations,
    coordinating,
    transactionOpen,
  } = input;

  if (
    !documentVisible ||
    protectedWork ||
    activeMutations > 0 ||
    coordinating ||
    transactionOpen ||
    state.activationPending ||
    state.reloadRequested ||
    state.convergenceStalled
  ) {
    return false;
  }

  if (state.updateRequired || state.status === "update-required") return true;

  return (
    (state.status === "available" || state.status === "failed") &&
    state.waitingToken !== null
  );
}

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



  /**
   * WO-145O — the build id this running JavaScript belongs to, and a fetcher for
   * the build id the origin currently serves. Together they are the authority a
   * "latest" claim must be proven against: `registration.update()` alone can
   * silently observe a cached worker script and produce a false "latest".
   * When omitted (unit fixtures), no remote claim is made and no check may
   * report "latest" on the strength of a remote comparison.
   */
  runningBuildId?: string;
  fetchRemoteBuildId?: () => Promise<string | null>;

  /**
   * WO-145P — convergence context. `bootedFromUpdate` is true when THIS document
   * was loaded by an update reload, and `convergenceHops` is how many such hops
   * have happened without reaching the published build. Together they let a check
   * say "one more update to install" instead of "latest" when the browser could
   * only promote an intermediate waiting worker. `onConverged` is called once the
   * running build provably equals the published build.
   */
  bootedFromUpdate?: () => boolean;
  convergenceHops?: () => number;
  onConverged?: () => void;

  minCheckIntervalMs?: number;

  /**
   * WO-145P — a manual check must always end. On the installed iOS client
   * `registration.update()` stayed pending for over a minute, so "Checking…"
   * never cleared. Both authorities are now bounded and a timeout is an honest,
   * retryable failure — never "latest".
   */
  registrationUpdateTimeoutMs?: number;
  remoteBuildTimeoutMs?: number;

  /** WO-145I — when the copy moves from "Preparing" to "Finishing update…". */
  activationSlowMs?: number;
  /** WO-145I — when the "taking longer than usual" reassurance appears. */
  activationVerySlowMs?: number;
  /** WO-145I — generous bound after which the close/reopen outcome is offered. */
  activationPendingCloseMs?: number;
}

const DEFAULT_MIN_CHECK_INTERVAL_MS = 60_000;
/** WO-145P — bounds for the two check authorities. */
export const DEFAULT_REGISTRATION_UPDATE_TIMEOUT_MS = 15_000;
export const DEFAULT_REMOTE_BUILD_TIMEOUT_MS = 10_000;

/** Resolve `promise`, or reject after `ms`. Never leaves a check hanging. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  sleep: (ms: number) => Promise<void> = (d) =>
    new Promise<void>((r) => setTimeout(r, d)),
): Promise<T> {
  let settled = false;
  const timeout = sleep(ms).then(() => {
    if (!settled) throw new Error("timeout");
    return undefined as unknown as T;
  });
  try {
    return await Promise.race([
      promise.then((v) => {
        settled = true;
        return v;
      }),
      timeout,
    ]);
  } finally {
    settled = true;
  }
}

/**
 * WO-145I — activation latency is browser-controlled, not application-controlled.
 *
 * Measured on genuine builds across 54 close-during-update runs: 53 activated in
 * 1.9–4.3s and one in 31.3s with a provably stable client set and zero pending
 * outgoing-worker requests. Treating the slow case as a failure produced the
 * rejected "The update couldn't finish / try again" experience, and a blind retry
 * is misleading while the original `skipWaiting()` may still complete.
 *
 * So SKIP_WAITING is a single irreversible transaction. These thresholds only
 * change what the member is told:
 *   - `SLOW`   → "Finishing update…";
 *   - `VERY_SLOW` → "This is taking longer than usual…" (still safe, still waiting);
 *   - `PENDING_CLOSE` → an honest outcome: the update finishes after VeggieMeet is
 *     fully closed and reopened, or the member continues on the current version.
 * The transaction keeps observing the worker lifecycle in every phase.
 */
const DEFAULT_ACTIVATION_SLOW_MS = 5_000;
const DEFAULT_ACTIVATION_VERY_SLOW_MS = 20_000;
const DEFAULT_ACTIVATION_PENDING_CLOSE_MS = 90_000;
/** How often the pending activation is re-checked against the registration. */
const ACTIVATION_POLL_MS = 250;
/**
 * WO-145I — SKIP_WAITING is one-shot, so it is re-posted only until the waiting
 * worker acknowledges it by leaving the `installed` state, and never beyond this
 * bounded window. After that, one transaction state is retained and its lifecycle
 * is observed — no indefinite reposting.
 */
const MAX_SKIP_WAITING_REPOSTS = 8;

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
  private phaseTimers: ReturnType<typeof setTimeout>[] = [];
  private activationPoll: ReturnType<typeof setInterval> | null = null;
  /** WO-145H — bounded nudge counter for the activation poll. */
  private activationTicks = 0;
  /** WO-145I — reposts issued for the open transaction. */
  private reposts = 0;
  /** WO-145I — the worker of the single open activation transaction. */
  private activationWorker: WorkerLike | null = null;

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
    activationPhase: "normal",
    activationPending: false,
    reloadRequested: false,
    lastCheckAt: null,
    lastCheckOutcome: null,
    remoteBuildId: null,
    chainedUpdate: false,
    convergenceStalled: false,
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
    // WO-145I — an open irreversible transaction is never downgraded to a fresh
    // "available" prompt by a later detection: one transaction, one lifecycle.
    if (this.state.activationPending) {
      this.set({ waitingToken: this.tokenSeq });
      return;
    }
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
      s.status === "pending-close" ||
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

  /**
   * WO-145O — a check is only complete once BOTH authorities have answered:
   *
   *  1. `registration.update()` — resolves, and any resulting installing/waiting
   *     worker is observed (an available worker is never ignored);
   *  2. `/version.json`, fetched uncacheably — the build the origin serves.
   *
   * Outcomes are recorded in state and are the ONLY thing the UI may speak from:
   *  - `update-available` — a waiting/installing worker exists, or the origin
   *     serves a different build than this document is running (the installed
   *     iOS failure mode: the worker script came from a cache, so no
   *     `updatefound` ever fired while a successor was genuinely published);
   *  - `latest` — proven equal build ids and no installing/waiting worker;
   *  - `failed` — offline, timeout, non-OK, unparseable, or an update() error.
   *     Never presented as "latest".
   *
   * Returns whether the check itself completed without error (kept boolean for
   * the watcher/debounce contract); truth about the result lives in state.
   */
  async checkForUpdate(reason: CheckReason): Promise<boolean> {
    const reg = this.registration;
    if (!reg) return false;
    if (this.state.checking) return false;
    if (reason !== "manual" && this.deps.isPaused?.() === true) return false;

    const min = this.deps.minCheckIntervalMs ?? DEFAULT_MIN_CHECK_INTERVAL_MS;
    const last = this.state.lastCheckAt;
    if (reason !== "manual" && last !== null && this.deps.now() - last < min)
      return false;

    this.set({
      checking: true,
      lastCheckAt: this.deps.now(),
      lastCheckOutcome: null,
    });

    let updateFailed = false;
    try {
      // WO-145P — bounded: the installed iOS client left this pending for over a
      // minute and "Checking…" never cleared.
      await withTimeout(
        Promise.resolve(reg.update()),
        this.deps.registrationUpdateTimeoutMs ?? DEFAULT_REGISTRATION_UPDATE_TIMEOUT_MS,
      );
    } catch {
      // A failed or timed-out check is never fatal: the current build keeps
      // working and the next trigger retries. Offline checks land here routinely.
      updateFailed = true;
    }

    // An installing or waiting worker must never be ignored by a check.
    this.scanForWaiting();
    const workerAvailable =
      !!reg.waiting || !!reg.installing || this.trackedWaiting !== null;

    // The remote authority is consulted even when update() failed: an installed
    // client can be provably stale while its worker script is served from cache.
    let remote: string | null = null;
    let remoteConsulted = false;
    if (this.deps.fetchRemoteBuildId) {
      remoteConsulted = true;
      try {
        remote = await withTimeout(
          Promise.resolve(this.deps.fetchRemoteBuildId()),
          this.deps.remoteBuildTimeoutMs ?? DEFAULT_REMOTE_BUILD_TIMEOUT_MS,
        );
      } catch {
        remote = null;
      }
    }
    const running = this.deps.runningBuildId ?? null;
    const remoteMismatch =
      remote !== null && running !== null && remote !== running;

    let outcome: CheckOutcome;
    if (workerAvailable || remoteMismatch) {
      outcome = "update-available";
    } else if (updateFailed || (remoteConsulted && remote === null)) {
      outcome = "failed";
    } else {
      outcome = "latest";
    }

    /*
     * WO-145P — convergence, not merely "newer". A registration has at most one
     * waiting worker, so a client behind by two releases can only be promoted to
     * the intermediate one. That is acceptable; declaring it current is not.
     */
    const bootedFromUpdate = this.deps.bootedFromUpdate?.() === true;
    const hops = this.deps.convergenceHops?.() ?? 0;
    const chained = remoteMismatch && bootedFromUpdate;
    const stalled = chained && hops >= MAX_CONVERGENCE_HOPS;

    if (outcome === "update-available") {
      // A member-initiated check always re-offers a postponed build: "Later"
      // suppresses one prompt, never future manual checks.
      if (reason === "manual" && this.state.dismissedToken !== null)
        this.set({ dismissedToken: null });
      // Provably stale with no waiting worker (cached worker script): converge
      // through the existing member-consented, single-reload path.
      if (!workerAvailable && remoteMismatch)
        this.enterUpdateRequired("remote_build_mismatch");
    }

    // Provably running the published build: the hop chain is closed.
    if (remote !== null && running !== null && remote === running) {
      try {
        this.deps.onConverged?.();
      } catch {
        /* bookkeeping must never break a check */
      }
    }

    this.set({
      checking: false,
      lastCheckOutcome: outcome,
      remoteBuildId: remote,
      chainedUpdate: chained,
      convergenceStalled: stalled,
    });
    return !updateFailed;

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
   *
   * WO-145I — once this returns "activating", SKIP_WAITING has been sent and the
   * transition is irreversible. It is never abandoned, never reported as a
   * failure for slowness, and never retried blindly: the single transaction's
   * lifecycle is observed until activation lands (immediately reloading when
   * safe) or the member is offered the honest close-and-reopen outcome.
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

    // WO-145I — exactly one activation transaction per client. A second consent
    // (repeated taps, a duplicate lifecycle message) joins the open one.
    if (this.state.activationPending && this.activationWorker === waiting)
      return "activating";

    if (!options.force && this.deps.hasUnsavedWork()) {
      this.deps.log("app_update_blocked_unsaved", {});
      this.set({ blockedByUnsavedWork: true });
      return "blocked";
    }

    this.deps.log("app_update_activation_requested", {
      forced: options.force === true,
    });
    this.activationWorker = waiting;
    this.reposts = 0;
    this.set({
      status: "activating",
      activationPending: true,
      activationPhase: "normal",
      reloadRequested: false,
      blockedByUnsavedWork: false,
    });
    this.deps.broadcast?.({ type: "activating" });

    // WO-145B: with `clientsClaim: false` the new worker activates without
    // claiming this document, so `controllerchange` may never fire. The
    // authoritative signal is the waiting worker reaching `activated`; a
    // reload then boots this client wholly onto the new build.
    const onActivated = () => {
      if (waiting.state === "activated" || waiting.state === "redundant")
        this.onActivationLanded("worker_activated");
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
    // the client may reload immediately.
    this.activationTicks = 0;
    this.activationPoll = setInterval(() => {
      if (!this.state.activationPending || this.reloaded) {
        this.clearActivationPoll();
        return;
      }
      const reg = this.registration;
      const promoted =
        waiting.state === "activated" ||
        waiting.state === "redundant" ||
        (reg !== null && reg.waiting !== waiting);
      if (promoted) {
        this.onActivationLanded("worker_activated");
        return;
      }
      // WO-145E/WO-145I: `SKIP_WAITING` is one-shot and can be observed while
      // the outgoing worker is still finishing work, in which case the promotion
      // does not land. Re-posting is idempotent (`skipWaiting()` is latched), but
      // it stops as soon as the worker acknowledges by leaving `installed`, and
      // in any case after a small bounded number of attempts — the transaction is
      // then simply observed rather than re-driven.
      if (waiting.state === "installed" && this.reposts < MAX_SKIP_WAITING_REPOSTS) {
        this.reposts += 1;
        try {
          waiting.postMessage(SKIP_WAITING_MESSAGE);
        } catch {
          /* the worker went away; the promotion checks above settle this */
        }
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

    // WO-145I — progressive, truthful status only. None of these timers cancels
    // or retries the transaction.
    const slow = this.deps.activationSlowMs ?? DEFAULT_ACTIVATION_SLOW_MS;
    const verySlow = this.deps.activationVerySlowMs ?? DEFAULT_ACTIVATION_VERY_SLOW_MS;
    const pendingClose =
      this.deps.activationPendingCloseMs ?? DEFAULT_ACTIVATION_PENDING_CLOSE_MS;
    this.phaseTimers = [
      setTimeout(() => {
        if (this.state.status !== "activating") return;
        this.deps.log("app_update_activation_slow", { phase: "slow" });
        this.set({ activationPhase: "slow" });
      }, slow),
      setTimeout(() => {
        if (this.state.status !== "activating") return;
        this.deps.log("app_update_activation_slow", { phase: "very_slow" });
        this.set({ activationPhase: "very-slow" });
      }, verySlow),
      setTimeout(() => {
        if (this.state.status !== "activating") return;
        // Still pending, and still safe: the browser owns this latency. The
        // member is told the truth — the update finishes after VeggieMeet is
        // fully closed and reopened — and may continue on the current version.
        this.deps.log("app_update_activation_pending_close", {});
        this.set({ status: "pending-close", activationPhase: "very-slow" });
      }, pendingClose),
    ];

    return "activating";
  }

  /**
   * WO-145I — activation landed. Reload exactly once when it is safe; if the
   * member has started new work since consenting (only possible after they chose
   * to continue on the current version), wait for explicit approval instead of
   * reloading over it.
   */
  private onActivationLanded(cause: string): void {
    if (this.reloaded) return;
    if (this.state.status === "activating" || this.state.status === "pending-close") {
      this.finishActivation(cause);
      return;
    }
    // The member continued on the current version and the promotion arrived
    // later. Never reload unexpectedly over newly entered work.
    if (!this.deps.hasUnsavedWork()) {
      this.finishActivation(cause);
      return;
    }
    this.deps.log("app_update_activation_deferred", { cause });
    this.clearActivationPoll();
    this.set({ status: "update-required", updateRequired: true });
  }

  /**
   * WO-145I — the member chose "Continue on current version" after a browser-
   * delayed activation. The transaction is not cancelled (it cannot be): it stays
   * observed, and a later activation is handled by `onActivationLanded`.
   */
  continueOnCurrentVersion(): void {
    if (this.state.status !== "pending-close") return;
    // A queued navigation cannot be cancelled: never pretend otherwise.
    if (this.state.reloadRequested) return;
    this.clearPhaseTimers();
    this.set({
      status: "available",
      dismissedToken: this.state.waitingToken,
      blockedByUnsavedWork: false,
    });
  }

  /** WO-145I — true while an irreversible activation request is outstanding. */
  isActivationPending(): boolean {
    return this.state.activationPending && !this.reloaded;
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
    if (this.state.status === "activating" || this.state.status === "pending-close")
      return;
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

  private clearActivationPoll(): void {
    if (this.activationPoll !== null) {
      clearInterval(this.activationPoll);
      this.activationPoll = null;
    }
  }

  private clearPhaseTimers(): void {
    this.phaseTimers.forEach((t) => clearTimeout(t));
    this.phaseTimers = [];
  }

  /** Reload exactly once for this client, for any activation path. */
  private finishActivation(cause: string): void {
    this.clearActivationPoll();
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
    /*
     * WO-145I — measured on genuine builds: when the outgoing worker leaves
     * `waiting` but the incoming worker's `activate` handler is still running,
     * Chromium *queues* this navigation until the promotion completes. The
     * document keeps running (and keeps painting) meanwhile, so the progressive
     * status timers are deliberately NOT cleared here: the member sees
     * "Preparing update…", then "Finishing update…", then the honest
     * close-and-reopen guidance, instead of one frozen line for 30 s.
     */
    this.set({ reloadRequested: true });
    this.deps.reload();
  }

  /**
   * WO-145I — reserved for the one genuine application-level failure: the
   * consent could not even be delivered to the waiting worker. Browser-controlled
   * activation latency is NEVER reported here.
   */
  private fail(cause: string): void {
    this.clearActivationPoll();
    this.clearPhaseTimers();
    this.deps.log("app_update_failed", { cause });
    this.set({ status: "failed", activationPending: false });
  }

  /** Retry after a failed delivery, without a second prompt cycle. */
  retry(): "activating" | "blocked" | "noop" {
    if (this.state.status !== "failed") return "noop";
    this.activationWorker = null;
    this.set({ status: "available", activationPending: false });
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
    // WO-145I — a controllerchange that arrives long after consent (including
    // after the member chose to continue on the current version) is honoured
    // through the safe path: reload when nothing would be lost, otherwise ask.
    if (!this.state.activationPending) return;
    this.onActivationLanded("controller_changed");
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
