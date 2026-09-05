import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POLL_INTERVAL_MS,
  SKIP_WAITING_MESSAGE,
  UpdateCoordinator,
  startUpdateWatchers,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";
import {
  CACHE_SCHEMA_VERSION,
  CRITICAL_QUERY_KEYS,
  invalidateCriticalQueries,
  isBuildMismatch,
  reconcileBuildMarkers,
} from "@/lib/buildFreshness";
import {
  hasUnsavedWork,
  registerUnsavedWork,
  resetUnsavedWork,
  unsavedWorkKinds,
  unsavedWorkSummary,
} from "@/lib/unsavedWork";

/* ---------- harness ---------- */

function makeWorker(state = "installed"): WorkerLike & {
  posted: unknown[];
  fire: () => void;
  setState: (s: string) => void;
} {
  const listeners: (() => void)[] = [];
  const posted: unknown[] = [];
  return {
    state,
    posted,
    postMessage: (m) => posted.push(m),
    addEventListener: (_t, l) => listeners.push(l),
    fire: () => listeners.forEach((l) => l()),
    setState(s: string) {
      this.state = s;
    },
  };
}

function makeHarness(options: { controlled?: boolean } = {}) {
  const controllerListeners: (() => void)[] = [];
  const updateFoundListeners: (() => void)[] = [];
  const container: ContainerLike & { changeController: () => void } = {
    controller: options.controlled === false ? null : makeWorker("activated"),
    addEventListener: (_t, l) => controllerListeners.push(l),
    changeController: () => controllerListeners.forEach((l) => l()),
  };
  const registration: RegistrationLike & { fireUpdateFound: () => void } = {
    installing: null,
    waiting: null,
    active: makeWorker("activated"),
    update: vi.fn(async () => {}),
    addEventListener: (_t, l) => updateFoundListeners.push(l),
    fireUpdateFound: () => updateFoundListeners.forEach((l) => l()),
  };
  const reload = vi.fn();
  const log = vi.fn();
  let dirty = false;
  let clock = 1_000;
  const order: string[] = [];
  const onActivated = vi.fn(() => {
    order.push("commit");
  });
  const coordinator = new UpdateCoordinator({
    container,
    reload: () => {
      order.push("reload");
      reload();
    },
    log,
    onActivated,
    now: () => clock,
    hasUnsavedWork: () => dirty,
    minCheckIntervalMs: 60_000,
    activationSlowMs: 1_000,
    activationVerySlowMs: 3_000,
    activationPendingCloseMs: 5_000,
  });

  return {
    container,
    registration,
    reload,
    onActivated,
    order: () => order,
    log,
    coordinator,
    setDirty: (v: boolean) => {
      dirty = v;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    events: () => log.mock.calls.map((c) => c[0] as string),
  };
}

describe("WO-145 update coordinator", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetUnsavedWork();
  });

  it("detects a waiting worker and offers exactly one prompt per build", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    expect(h.coordinator.shouldPrompt()).toBe(false);

    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();

    expect(h.coordinator.getState().status).toBe("available");
    expect(h.coordinator.shouldPrompt()).toBe(true);
    h.coordinator.notePromptShown();
    h.coordinator.notePromptShown();
    expect(h.events().filter((e) => e === "app_update_prompt_shown")).toHaveLength(1);
    expect(h.events()).toContain("app_update_detected");
  });

  it("never prompts for the very first install (no controller yet)", () => {
    const h = makeHarness({ controlled: false });
    h.coordinator.attach(h.registration);
    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();
    expect(h.coordinator.shouldPrompt()).toBe(false);
    expect(h.coordinator.getState().status).toBe("idle");
  });

  it("promotes an installing worker only once it reaches installed", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const worker = makeWorker("installing");
    h.registration.installing = worker;
    h.registration.fireUpdateFound();
    expect(h.coordinator.shouldPrompt()).toBe(false);

    worker.setState("installed");
    worker.fire();
    expect(h.coordinator.shouldPrompt()).toBe(true);
  });

  it("Later suppresses the prompt for that build only, and keeps working", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();

    h.coordinator.dismiss();
    expect(h.coordinator.shouldPrompt()).toBe(false);
    expect(h.events()).toContain("app_update_postponed");
    expect(h.reload).not.toHaveBeenCalled();

    // A newer build re-prompts.
    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();
    expect(h.coordinator.shouldPrompt()).toBe(true);
  });

  it("Update now activates the waiting worker and reloads exactly once", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    expect(h.coordinator.applyUpdate()).toBe("activating");
    expect(waiting.posted).toEqual([SKIP_WAITING_MESSAGE]);

    h.container.changeController();
    h.container.changeController();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.events()).toContain("app_update_activation_requested");
    expect(h.events()).toContain("app_update_controller_changed");
  });

  it("does not reload when another client's activation changes the controller", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();

    h.container.changeController(); // sibling tab activated, we never asked
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("blocks activation while unsaved work exists, then allows a forced update", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    h.setDirty(true);
    expect(h.coordinator.applyUpdate()).toBe("blocked");
    expect(waiting.posted).toHaveLength(0);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.coordinator.getState().blockedByUnsavedWork).toBe(true);
    expect(h.events()).toContain("app_update_blocked_unsaved");

    expect(h.coordinator.applyUpdate({ force: true })).toBe("activating");
    expect(waiting.posted).toEqual([SKIP_WAITING_MESSAGE]);
  });

  /* ---------- WO-145I: browser-controlled activation latency ---------- */

  it("reports progressive status while activation is pending, never a failure", () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    h.coordinator.applyUpdate();
    expect(h.coordinator.getState().activationPhase).toBe("normal");
    vi.advanceTimersByTime(1_001);
    expect(h.coordinator.getState().activationPhase).toBe("slow");
    vi.advanceTimersByTime(2_001);
    expect(h.coordinator.getState().activationPhase).toBe("very-slow");
    expect(h.coordinator.getState().status).toBe("activating");
    expect(h.events()).not.toContain("app_update_failed");

    // Past the generous bound the member gets the honest close/reopen outcome —
    // not "the update couldn't finish", and no blind retry.
    vi.advanceTimersByTime(2_001);
    expect(h.coordinator.getState().status).toBe("pending-close");
    expect(h.events()).toContain("app_update_activation_pending_close");
    expect(h.events()).not.toContain("app_update_failed");
    expect(h.reload).not.toHaveBeenCalled();

    // The transaction is still observed: a late activation reloads exactly once.
    waiting.setState("activated");
    vi.advanceTimersByTime(300);
    expect(h.reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("stops re-posting SKIP_WAITING once the worker acknowledges it", () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    h.coordinator.applyUpdate();
    vi.advanceTimersByTime(600); // two poll ticks while still `installed`
    const beforeAck = waiting.posted.length;
    expect(beforeAck).toBeGreaterThan(1);
    waiting.setState("activating"); // acknowledged, promotion in progress
    vi.advanceTimersByTime(1_000);
    expect(waiting.posted).toHaveLength(beforeAck);
    // And reposting is bounded even if the worker never acknowledges.
    vi.useRealTimers();
  });

  it("keeps the member on the current version without reloading over new work", () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    h.coordinator.applyUpdate();
    vi.advanceTimersByTime(5_001);
    expect(h.coordinator.getState().status).toBe("pending-close");

    h.coordinator.continueOnCurrentVersion();
    expect(h.coordinator.shouldPrompt()).toBe(false);
    expect(h.coordinator.isActivationPending()).toBe(true);

    // The member starts new work, then activation finally lands: no surprise
    // reload — explicit approval is required.
    h.setDirty(true);
    h.container.changeController();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.coordinator.getState().status).toBe("update-required");

    expect(h.coordinator.reloadIfSafe({ force: true })).toBe("reloaded");
    expect(h.reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("opens exactly one activation transaction for repeated consent", () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    expect(h.coordinator.applyUpdate()).toBe("activating");
    expect(h.coordinator.applyUpdate()).toBe("activating");
    expect(
      h.events().filter((e) => e === "app_update_activation_requested"),
    ).toHaveLength(1);
    expect(waiting.posted).toHaveLength(1);
    vi.useRealTimers();
  });


  it("is a no-op when there is no waiting worker", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    expect(h.coordinator.applyUpdate()).toBe("noop");
    expect(h.coordinator.retry()).toBe("noop");
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("debounces automatic checks but always honours a manual check", async () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const update = h.registration.update as ReturnType<typeof vi.fn>;
    update.mockClear();

    expect(await h.coordinator.checkForUpdate("launch")).toBe(true);
    expect(await h.coordinator.checkForUpdate("visible")).toBe(false);
    expect(await h.coordinator.checkForUpdate("focus")).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);

    expect(await h.coordinator.checkForUpdate("manual")).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);

    h.advance(60_001);
    expect(await h.coordinator.checkForUpdate("reconnect")).toBe(true);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("survives a failed check without breaking the current build", async () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    (h.registration.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("offline"),
    );
    expect(await h.coordinator.checkForUpdate("manual")).toBe(false);
    expect(h.coordinator.getState().checking).toBe(false);
    expect(h.coordinator.getState().status).toBe("idle");
  });

  it("checks on visibility, focus, reconnect, resume and interval", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const spy = vi.spyOn(h.coordinator, "checkForUpdate").mockResolvedValue(true);

    const winListeners = new Map<string, () => void>();
    const docListeners = new Map<string, () => void>();
    let intervalFn: (() => void) | null = null;
    const stop = startUpdateWatchers(h.coordinator, {
      win: {
        addEventListener: (t, l) => winListeners.set(t, l),
        removeEventListener: (t) => winListeners.delete(t),
      },
      doc: {
        visibilityState: "visible",
        addEventListener: (t, l) => docListeners.set(t, l),
        removeEventListener: (t) => docListeners.delete(t),
      },
      setIntervalFn: (fn) => {
        intervalFn = fn;
        return 1;
      },
      clearIntervalFn: () => {},
    });

    docListeners.get("visibilitychange")?.();
    winListeners.get("focus")?.();
    winListeners.get("online")?.();
    winListeners.get("pageshow")?.();
    intervalFn?.();

    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      "visible",
      "focus",
      "reconnect",
      "visible",
      "interval",
    ]);
    stop();
    expect(winListeners.size).toBe(0);
    expect(docListeners.size).toBe(0);
    expect(DEFAULT_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });
});

/* ---------- unsaved work registry ---------- */

describe("WO-145 unsaved-work registry", () => {
  beforeEach(() => resetUnsavedWork());

  it("reports nothing when no screen is dirty", () => {
    const off = registerUnsavedWork("a", "composer", () => false);
    expect(hasUnsavedWork()).toBe(false);
    off();
  });

  it("aggregates dirty kinds and unregisters cleanly", () => {
    const offA = registerUnsavedWork("a", "composer", () => true);
    const offB = registerUnsavedWork("b", "meetup_editor", () => true);
    expect(unsavedWorkKinds().sort()).toEqual(["composer", "meetup_editor"]);
    expect(unsavedWorkSummary(unsavedWorkKinds())).toContain(" and ");
    offA();
    offB();
    expect(hasUnsavedWork()).toBe(false);
  });

  it("never lets a throwing predicate block updates forever", () => {
    registerUnsavedWork("bad", "upload", () => {
      throw new Error("boom");
    });
    expect(hasUnsavedWork()).toBe(false);
  });
});

/* ---------- build / cache freshness ---------- */

describe("WO-145 build freshness", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it("treats the first run as first-run and records markers", () => {
    const s = memoryStorage();
    expect(reconcileBuildMarkers(s, "B1", CACHE_SCHEMA_VERSION)).toBe("first-run");
    expect(s.map.get("veggiemeet_build_id")).toBe("B1");
    expect(reconcileBuildMarkers(s, "B1", CACHE_SCHEMA_VERSION)).toBe("unchanged");
  });

  it("detects a build change and a cache-schema mismatch", () => {
    const s = memoryStorage();
    reconcileBuildMarkers(s, "B1", "2");
    expect(reconcileBuildMarkers(s, "B2", "2")).toBe("build-changed");
    expect(reconcileBuildMarkers(s, "B2", "3")).toBe("schema-changed");
  });

  it("degrades silently when storage is unavailable", () => {
    expect(reconcileBuildMarkers(null, "B1")).toBe("unchanged");
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(reconcileBuildMarkers(hostile, "B1")).toBe("unchanged");
  });

  it("invalidates only the critical authenticated queries, never everything", () => {
    const calls: unknown[] = [];
    const n = invalidateCriticalQueries({
      invalidateQueries: (f) => calls.push(f.queryKey),
    });
    expect(n).toBe(CRITICAL_QUERY_KEYS.length);
    expect(calls).toContainEqual(["profile"]);
    expect(calls).toContainEqual(["notifications-unread-count"]);
    // Auth/session storage keys are never part of the invalidation set.
    expect(CRITICAL_QUERY_KEYS.join(",")).not.toMatch(/token|auth|session/i);
  });

  it("flags a build mismatch only when the origin really differs", () => {
    expect(isBuildMismatch("B2", "B1")).toBe(true);
    expect(isBuildMismatch("B1", "B1")).toBe(false);
    expect(isBuildMismatch(null, "B1")).toBe(false);
  });
});

describe("WO-145F activation ordering", () => {
  it("tells siblings only after the new worker is active, then reloads once", () => {
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    expect(h.coordinator.applyUpdate({ force: true })).toBe("activating");
    // Nothing is announced while the promotion is still pending: a sibling that
    // navigated now would do so through the outgoing worker.
    expect(h.onActivated).not.toHaveBeenCalled();

    waiting.setState("activated");
    waiting.fire();

    expect(h.order()).toEqual(["commit", "reload"]);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });
});

/* ---------- WO-145I: browser-held navigation ---------- */

describe("WO-145I queued navigation", () => {
  it("keeps escalating the status while the browser holds the reload", () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.coordinator.attach(h.registration);
    const waiting = makeWorker("installed");
    h.registration.waiting = waiting;
    h.registration.fireUpdateFound();

    h.coordinator.applyUpdate({ force: true });
    waiting.setState("activated");
    waiting.fire();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getState().reloadRequested).toBe(true);

    // The document is still alive: the member must not be shown one frozen line.
    vi.advanceTimersByTime(1_100);
    expect(h.coordinator.getState().activationPhase).toBe("slow");
    vi.advanceTimersByTime(2_100);
    expect(h.coordinator.getState().activationPhase).toBe("very-slow");
    vi.advanceTimersByTime(2_100);
    expect(h.coordinator.getState().status).toBe("pending-close");

    // Nothing can cancel a queued navigation, and there is never a second reload.
    h.coordinator.continueOnCurrentVersion();
    expect(h.coordinator.getState().status).toBe("pending-close");
    expect(h.reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
