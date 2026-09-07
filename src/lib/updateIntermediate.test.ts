import { describe, expect, it, vi } from "vitest";
import {
  UpdateCoordinator,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";
import { MAX_CONVERGENCE_HOPS } from "@/lib/updateConvergence";

/**
 * WO-145P — the installed iPhone client ran build A (`20260906T0904Z`) with the
 * build-B worker (`20260907T0545Z`) already waiting from the previous release,
 * while build C (`20260907T0700Z`) was the published build. One check + one
 * consent promoted B (the only worker a registration can promote) and B then
 * declared itself current.
 *
 * These tests pin the two corrections:
 *  1. both check authorities are bounded, so "Checking…" always ends;
 *  2. a document that booted from an update reload and still finds a newer
 *     published build reports one more update — never "latest".
 */

const A = "20260906T0904Z";
const B = "20260907T0545Z";
const C = "20260907T0700Z";

function worker(state = "installed"): WorkerLike {
  return { state, postMessage: () => {}, addEventListener: () => {} };
}

function harness(options: {
  running: string;
  remote: string | null;
  waiting?: boolean;
  bootedFromUpdate?: boolean;
  hops?: number;
  updateNeverResolves?: boolean;
}) {
  const container: ContainerLike = {
    controller: worker("activated"),
    addEventListener: () => {},
  };
  const waiting = options.waiting ? worker("installed") : null;
  const registration: RegistrationLike = {
    installing: null,
    waiting,
    active: worker("activated"),
    update: vi.fn(
      () => (options.updateNeverResolves ? new Promise<void>(() => {}) : Promise.resolve()),
    ),
    addEventListener: () => {},
  };
  const onConverged = vi.fn();
  const coordinator = new UpdateCoordinator({
    container,
    reload: vi.fn(),
    now: () => 1_000,
    log: vi.fn(),
    hasUnsavedWork: () => false,
    runningBuildId: options.running,
    fetchRemoteBuildId: async () => options.remote,
    bootedFromUpdate: () => options.bootedFromUpdate === true,
    convergenceHops: () => options.hops ?? 0,
    onConverged,
    registrationUpdateTimeoutMs: 20,
    remoteBuildTimeoutMs: 20,
  });
  coordinator.attach(registration);
  return { coordinator, registration, onConverged, waiting };
}

describe("WO-145P — bounded update check", () => {
  it("ends the check when registration.update() never resolves", async () => {
    const h = harness({ running: A, remote: A, updateNeverResolves: true });
    await h.coordinator.checkForUpdate("manual");
    const s = h.coordinator.getState();
    expect(s.checking).toBe(false);
    // A timed-out check is honest and retryable, never "latest".
    expect(s.lastCheckOutcome).toBe("failed");
  });

  it("ends the check when the remote marker never answers", async () => {
    const container: ContainerLike = {
      controller: worker("activated"),
      addEventListener: () => {},
    };
    const coordinator = new UpdateCoordinator({
      container,
      reload: vi.fn(),
      now: () => 1_000,
      log: vi.fn(),
      hasUnsavedWork: () => false,
      runningBuildId: A,
      fetchRemoteBuildId: () => new Promise<string | null>(() => {}),
      registrationUpdateTimeoutMs: 20,
      remoteBuildTimeoutMs: 20,
    });
    coordinator.attach({
      installing: null,
      waiting: null,
      active: worker("activated"),
      update: async () => {},
      addEventListener: () => {},
    });
    await coordinator.checkForUpdate("manual");
    expect(coordinator.getState().checking).toBe(false);
    expect(coordinator.getState().lastCheckOutcome).toBe("failed");
  });
});

describe("WO-145P — an intermediate build never reports latest", () => {
  it("A with B waiting and C published offers the update", async () => {
    const h = harness({ running: A, remote: C, waiting: true });
    await h.coordinator.checkForUpdate("manual");
    const s = h.coordinator.getState();
    expect(s.lastCheckOutcome).toBe("update-available");
    expect(s.remoteBuildId).toBe(C);
    // No update reload preceded this document: ordinary available update.
    expect(s.chainedUpdate).toBe(false);
  });

  it("B running after the update reload, with C published, reports one more update", async () => {
    const h = harness({ running: B, remote: C, bootedFromUpdate: true, hops: 1 });
    await h.coordinator.checkForUpdate("launch");
    const s = h.coordinator.getState();
    expect(s.lastCheckOutcome).toBe("update-available");
    expect(s.chainedUpdate).toBe(true);
    expect(s.convergenceStalled).toBe(false);
    // Converges through the existing consent-only, single-reload path.
    expect(s.updateRequired).toBe(true);
    expect(h.onConverged).not.toHaveBeenCalled();
  });

  it("closes the chain and clears the markers once C is running", async () => {
    const h = harness({ running: C, remote: C, bootedFromUpdate: true, hops: 2 });
    await h.coordinator.checkForUpdate("launch");
    const s = h.coordinator.getState();
    expect(s.lastCheckOutcome).toBe("latest");
    expect(s.chainedUpdate).toBe(false);
    expect(h.onConverged).toHaveBeenCalledTimes(1);
  });

  it("reports honestly instead of looping when hops are exhausted", async () => {
    const h = harness({
      running: B,
      remote: C,
      bootedFromUpdate: true,
      hops: MAX_CONVERGENCE_HOPS,
    });
    await h.coordinator.checkForUpdate("manual");
    const s = h.coordinator.getState();
    expect(s.convergenceStalled).toBe(true);
    expect(s.lastCheckOutcome).toBe("update-available");
    expect(s.lastCheckOutcome).not.toBe("latest");
  });

  it("A→B→C: every hop is offered and only the last one is latest", async () => {
    // Hop 1: A running, B waiting, C published.
    const hop1 = harness({ running: A, remote: C, waiting: true });
    await hop1.coordinator.checkForUpdate("manual");
    expect(hop1.coordinator.getState().lastCheckOutcome).toBe("update-available");
    expect(hop1.coordinator.applyUpdate()).toBe("activating");

    // Hop 2: the promoted worker was B (the only promotable one). C still published.
    const hop2 = harness({ running: B, remote: C, waiting: true, bootedFromUpdate: true, hops: 1 });
    await hop2.coordinator.checkForUpdate("launch");
    expect(hop2.coordinator.getState().lastCheckOutcome).toBe("update-available");
    expect(hop2.coordinator.getState().chainedUpdate).toBe(true);
    expect(hop2.coordinator.applyUpdate()).toBe("activating");

    // Hop 3: C running and C published — the chain closes.
    const hop3 = harness({ running: C, remote: C, bootedFromUpdate: true, hops: 2 });
    await hop3.coordinator.checkForUpdate("launch");
    expect(hop3.coordinator.getState().lastCheckOutcome).toBe("latest");
    expect(hop3.coordinator.getState().chainedUpdate).toBe(false);
  });
});
