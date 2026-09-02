import { describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_RECOVERY_KEY,
  consumeActivationRecoveryBudget,
} from "@/lib/activationRecovery";
import {
  UpdateCoordinator,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

function makeWorker(state = "installed") {
  const listeners: (() => void)[] = [];
  const posted: unknown[] = [];
  const worker: WorkerLike & { posted: unknown[]; fire: () => void } = {
    state,
    posted,
    postMessage: (m) => posted.push(m),
    addEventListener: (_t, l) => listeners.push(l),
    fire: () => listeners.forEach((l) => l()),
  };
  return worker;
}

/**
 * A legacy client: the previously published worker (`skipWaiting: true`) is
 * active, the first prompt-mode worker is installed and never leaves `waiting`
 * because this document still holds the old worker.
 */
function legacyHarness(allowRecoveryReload: () => boolean) {
  const waiting = makeWorker("installed");
  const container: ContainerLike = {
    controller: makeWorker("activated"),
    addEventListener: () => {},
  };
  const registration: RegistrationLike & { fireUpdateFound: () => void } = {
    installing: null,
    waiting,
    active: makeWorker("activated"),
    update: vi.fn(async () => {}),
    addEventListener: () => {},
    fireUpdateFound: () => {},
  };
  const reload = vi.fn();
  const log = vi.fn();
  const coordinator = new UpdateCoordinator({
    container,
    reload,
    log,
    now: () => 1_000,
    hasUnsavedWork: () => false,
    activationTimeoutMs: 1_000,
    allowRecoveryReload,
  });
  coordinator.attach(registration);
  return { coordinator, waiting, reload, log };
}

describe("WO-145C activation recovery budget", () => {
  it("grants the reload exactly once per build", () => {
    const s = memoryStorage();
    expect(consumeActivationRecoveryBudget(s, "buildA")).toBe(true);
    expect(consumeActivationRecoveryBudget(s, "buildA")).toBe(false);
    expect(s.map.get(ACTIVATION_RECOVERY_KEY)).toBe("buildA");
  });

  it("grants a fresh reload for a genuinely newer build", () => {
    const s = memoryStorage();
    expect(consumeActivationRecoveryBudget(s, "buildA")).toBe(true);
    expect(consumeActivationRecoveryBudget(s, "buildB")).toBe(true);
  });

  it("refuses without storage, so it can never loop in private mode", () => {
    expect(consumeActivationRecoveryBudget(null, "buildA")).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(consumeActivationRecoveryBudget(throwing, "buildA")).toBe(false);
  });
});

describe("WO-145C legacy activation bridge", () => {
  it("reloads once when a legacy worker never promotes the waiting build", async () => {
    vi.useFakeTimers();
    const { coordinator, waiting, reload, log } = legacyHarness(() => true);

    expect(coordinator.applyUpdate({ force: true })).toBe("activating");
    expect(waiting.posted).toEqual([{ type: "SKIP_WAITING" }]);
    // The legacy worker keeps it parked: no statechange ever arrives.
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
    const causes = log.mock.calls.map((c) => (c[1] as { cause?: string })?.cause);
    expect(causes).toContain("activation_timeout_recovery");
    vi.useRealTimers();
  });

  it("surfaces the recoverable error instead of reloading once the budget is spent", async () => {
    vi.useFakeTimers();
    const { coordinator, reload, log } = legacyHarness(() => false);

    coordinator.applyUpdate({ force: true });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reload).not.toHaveBeenCalled();
    expect(coordinator.getState().status).toBe("failed");
    expect(log.mock.calls.map((c) => c[0])).toContain("app_update_failed");
    vi.useRealTimers();
  });

  it("prefers the real activation signal over the bridge", async () => {
    vi.useFakeTimers();
    const allow = vi.fn(() => true);
    const { coordinator, waiting, reload } = legacyHarness(allow);

    coordinator.applyUpdate({ force: true });
    waiting.state = "activated";
    waiting.fire();

    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    // The bridge budget is never touched, and there is no second reload.
    expect(allow).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
