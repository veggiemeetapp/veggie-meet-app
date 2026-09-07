/**
 * WO-145Q — the full observed lifecycle, deterministically.
 *
 * Recording IMG_0012.MP4 + production telemetry:
 *   13:31:30Z  manual check on build 20260907T0545Z ("Checking…" ~2 min)
 *   13:33:50Z  one consent ("Update now")
 *   13:34:00Z→ blank document (~60s) while auth initialised
 *   13:34:52Z  onboarding_step_viewed{welcome}   ← authentication flash
 *   13:35:35Z  app_update_reload_completed{build-changed}  ← ONE reload landed
 *   13:35:38Z  app_update_build_mismatch{remote_build_mismatch} ← second reload demanded
 *
 * These tests pin the corrected behaviour of the last step: a consented update
 * completes its own handover with one further reload and no member action, and a
 * client without consent — or with work in progress — is still only ever asked.
 */
import { describe, expect, it, vi } from "vitest";
import {
  UpdateCoordinator,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";
import {
  classifyHandover,
  hasConsent,
  noteAutoReload,
  readAutoReloads,
  recordConsent,
} from "@/lib/updateHandover";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

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

function harness() {
  const controllerListeners: (() => void)[] = [];
  const updateFound: (() => void)[] = [];
  const container: ContainerLike & { changeController: () => void } = {
    controller: makeWorker("activated"),
    addEventListener: (_t, l) => controllerListeners.push(l),
    changeController: () => controllerListeners.forEach((l) => l()),
  };
  const registration: RegistrationLike & { fireUpdateFound: () => void } = {
    installing: null,
    waiting: null,
    active: makeWorker("activated"),
    update: vi.fn(async () => {}),
    addEventListener: (_t, l) => updateFound.push(l),
    fireUpdateFound: () => updateFound.forEach((l) => l()),
  };
  const reload = vi.fn();
  let dirty = false;
  const coordinator = new UpdateCoordinator({
    container,
    reload,
    log: vi.fn(),
    now: () => Date.now(),
    hasUnsavedWork: () => dirty,
  });
  return {
    container,
    registration,
    reload,
    coordinator,
    setDirty: (v: boolean) => {
      dirty = v;
    },
  };
}

describe("WO-145Q consent → newly active worker → one handover", () => {
  it("reloads exactly once for the consent, then completes the handover once", () => {
    const store = memoryStorage();
    const h = harness();
    h.coordinator.attach(h.registration);
    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();

    // The member consents once.
    recordConsent(store);
    expect(h.coordinator.applyUpdate()).toBe("activating");

    // The new worker becomes active and this client reloads exactly once.
    h.container.changeController();
    h.container.changeController();
    expect(h.reload).toHaveBeenCalledTimes(1);

    // The returning document is still provably stale: previously this produced
    // "This window needs to update … Reload now".
    const stale = harness();
    stale.coordinator.attach(stale.registration);
    stale.coordinator.enterUpdateRequired("remote_build_mismatch");
    const state = stale.coordinator.getState();
    expect(state.updateRequired).toBe(true);

    const decision = classifyHandover({
      updateRequired: state.updateRequired,
      consented: hasConsent(store),
      autoReloads: readAutoReloads(store),
      dirty: false,
      reloadRequested: state.reloadRequested,
    });
    expect(decision).toBe("auto-reload");

    noteAutoReload(store);
    expect(stale.coordinator.reloadIfSafe({ force: false })).toBe("reloaded");
    expect(stale.reload).toHaveBeenCalledTimes(1);

    // And the budget is spent: a still-stale origin asks, never loops.
    const after = classifyHandover({
      updateRequired: true,
      consented: hasConsent(store),
      autoReloads: readAutoReloads(store),
      dirty: false,
    });
    expect(after).toBe("prompt");
  });

  it("asks instead of reloading when the member has work in progress", () => {
    const store = memoryStorage();
    recordConsent(store);
    const h = harness();
    h.coordinator.attach(h.registration);
    h.coordinator.enterUpdateRequired("remote_build_mismatch");
    h.setDirty(true);

    expect(
      classifyHandover({
        updateRequired: true,
        consented: hasConsent(store),
        autoReloads: readAutoReloads(store),
        dirty: true,
      }),
    ).toBe("prompt");
    expect(h.coordinator.reloadIfSafe({ force: false })).toBe("blocked");
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("never reloads a client that was never consented", () => {
    const store = memoryStorage();
    const h = harness();
    h.coordinator.attach(h.registration);
    h.coordinator.enterUpdateRequired("remote_build_mismatch");
    expect(
      classifyHandover({
        updateRequired: true,
        consented: hasConsent(store),
        autoReloads: readAutoReloads(store),
        dirty: false,
      }),
    ).toBe("prompt");
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("a controller change without an outstanding consent still never reloads", () => {
    const h = harness();
    h.coordinator.attach(h.registration);
    h.registration.waiting = makeWorker("installed");
    h.registration.fireUpdateFound();
    h.container.changeController(); // sibling activated it
    expect(h.reload).not.toHaveBeenCalled();
  });
});
