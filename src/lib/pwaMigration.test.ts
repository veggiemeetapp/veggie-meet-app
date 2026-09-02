import { describe, expect, it, vi } from "vitest";
import {
  BRIDGE_RELEASE_ID,
  MIGRATION_MARKER_KEY,
  allowsAutomaticActivation,
  hasCrossedBridge,
  isSanctionedBridge,
  recordBridgeCrossing,
  requiresMemberConsent,
  shouldPromptForTransition,
} from "@/lib/pwaMigration";
import { UpdateCoordinator, type RegistrationLike, type WorkerLike } from "@/lib/pwaUpdate";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

function makeWorker(state: string): WorkerLike & { fire: () => void; posted: unknown[] } {
  const listeners: Array<() => void> = [];
  return {
    state,
    posted: [] as unknown[],
    postMessage(message: unknown) {
      (this as unknown as { posted: unknown[] }).posted.push(message);
    },
    addEventListener: (_t: "statechange", l: () => void) => listeners.push(l),
    removeEventListener: () => {},
    fire: () => listeners.forEach((l) => l()),
  };
}

describe("WO-145D bridge is versioned and temporary", () => {
  it("treats only the sanctioned bridge id as the bridge", () => {
    expect(isSanctionedBridge("bridge", BRIDGE_RELEASE_ID)).toBe(true);
    // A later accidental bridge-mode build cannot re-enable auto activation.
    expect(isSanctionedBridge("bridge", "wo999-some-other-bridge")).toBe(false);
    expect(isSanctionedBridge("prompt", BRIDGE_RELEASE_ID)).toBe(false);
    expect(isSanctionedBridge("prompt", "")).toBe(false);
  });

  it("permits automatic activation only at the L→B boundary", () => {
    expect(allowsAutomaticActivation("bridge", BRIDGE_RELEASE_ID)).toBe(true);
    expect(allowsAutomaticActivation("prompt", "")).toBe(false);
    expect(allowsAutomaticActivation("bridge", "unsanctioned")).toBe(false);
  });

  it("requires member consent for B→N and every later release", () => {
    expect(requiresMemberConsent("prompt", "")).toBe(true);
    expect(shouldPromptForTransition("prompt", "")).toBe(true);
    // The bridge transition itself is never prompted for.
    expect(shouldPromptForTransition("bridge", BRIDGE_RELEASE_ID)).toBe(false);
  });

  it("records the crossing exactly once per client and never prompts twice", () => {
    const s = memoryStorage();
    expect(recordBridgeCrossing(s, BRIDGE_RELEASE_ID)).toBe("recorded");
    expect(recordBridgeCrossing(s, BRIDGE_RELEASE_ID)).toBe("already");
    expect(s.data[MIGRATION_MARKER_KEY]).toBe(BRIDGE_RELEASE_ID);
    expect(hasCrossedBridge(s)).toBe(true);
  });

  it("degrades safely without storage instead of looping", () => {
    expect(recordBridgeCrossing(null, BRIDGE_RELEASE_ID)).toBe("unavailable");
    expect(hasCrossedBridge(null)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    };
    expect(recordBridgeCrossing(throwing, BRIDGE_RELEASE_ID)).toBe("unavailable");
    expect(hasCrossedBridge(throwing)).toBe(false);
  });
});

describe("WO-145D activation has no registration-removal fallback", () => {
  it("finishes as soon as the registration drops the waiting worker", async () => {
    vi.useFakeTimers();
    const waiting = makeWorker("installed");
    const registration: RegistrationLike = {
      installing: null,
      waiting,
      active: makeWorker("activated"),
      update: vi.fn(async () => {}),
      addEventListener: () => {},
    };
    const reload = vi.fn();
    const coordinator = new UpdateCoordinator({
      container: { controller: makeWorker("activated"), addEventListener: () => {} },
      reload,
      log: vi.fn(),
      now: () => 1_000,
      hasUnsavedWork: () => false,
      activationTimeoutMs: 5_000,
    });
    coordinator.attach(registration);
    coordinator.applyUpdate({ force: true });

    registration.waiting = null; // promoted, no observable statechange
    await vi.advanceTimersByTimeAsync(300);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("surfaces a retryable failure — never a reload or unregister — on a stall", async () => {
    vi.useFakeTimers();
    const waiting = makeWorker("installed");
    const reload = vi.fn();
    const log = vi.fn();
    const coordinator = new UpdateCoordinator({
      container: { controller: makeWorker("activated"), addEventListener: () => {} },
      reload,
      log,
      now: () => 1_000,
      hasUnsavedWork: () => false,
      activationTimeoutMs: 1_000,
    });
    coordinator.attach({
      installing: null,
      waiting,
      active: makeWorker("activated"),
      update: vi.fn(async () => {}),
      addEventListener: () => {},
    });

    coordinator.applyUpdate({ force: true });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(reload).not.toHaveBeenCalled();
    expect(coordinator.getState().status).toBe("failed");
    expect(
      log.mock.calls.map((c) => (c[1] as { cause?: string })?.cause),
    ).toContain("controller_timeout");
    vi.useRealTimers();
  });

  it("exposes no registration-release dependency at all", () => {
    const coordinator = new UpdateCoordinator({
      container: { controller: null, addEventListener: () => {} },
      reload: () => {},
      log: () => {},
      now: () => 0,
      hasUnsavedWork: () => false,
    });
    const keys = Object.keys(coordinator as unknown as Record<string, unknown>);
    expect(keys.join(",")).not.toMatch(/release|unregister/i);
  });
});
