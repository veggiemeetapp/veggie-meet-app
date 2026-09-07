/**
 * WO-145Q CORRECTION — genuine A → B → C bounded-update-session harness.
 *
 * Recording IMG_0012.MP4 + production telemetry:
 *   13:31:30Z  manual check on build 20260907T0545Z ("Checking…" ~2 min)
 *   13:33:50Z  one consent ("Update now")
 *   13:34:00Z→ blank document (~60s) while auth initialised
 *   13:34:52Z  onboarding_step_viewed{welcome}   ← authentication flash
 *   13:35:35Z  app_update_reload_completed{build-changed}  ← reload 1 landed
 *   13:35:38Z  app_update_build_mismatch{remote_build_mismatch} ← second reload demanded
 *
 * The corrected behaviour, proven end to end below: one member consent drives a
 * bounded session across a real state machine — A active, B waiting, C published
 * — landing on B, surviving the reload, detecting C without claiming "latest",
 * and completing on C with NO further member action. The honest total is TWO
 * controlled reloads.
 */
import { describe, expect, it, vi } from "vitest";
import {
  UpdateCoordinator,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";
import {
  MAX_UPDATE_SESSION_RELOADS,
  classifyHandover,
  endUpdateSession,
  isUpdateSessionActive,
  noteSessionReload,
  readSessionReloads,
  startUpdateSession,
  updateSessionId,
} from "@/lib/updateHandover";
import { classifyAuthGate } from "@/lib/authHydration";

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

/** One document of the installed PWA, running a specific build. */
function documentHarness(options: {
  runningBuild: string;
  remoteBuild: string;
  store: ReturnType<typeof memoryStorage>;
  reloads: { count: number };
  dirty?: () => boolean;
}) {
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
  const log = vi.fn();
  const coordinator = new UpdateCoordinator({
    container,
    // Every controlled reload of the session is counted here — exactly as the
    // provider does — so the total is honest.
    reload: () => {
      noteSessionReload(options.store);
      options.reloads.count += 1;
    },
    log,
    now: () => Date.now(),
    hasUnsavedWork: () => options.dirty?.() ?? false,
    runningBuildId: options.runningBuild,
    fetchRemoteBuildId: async () => options.remoteBuild,
  });
  coordinator.attach(registration);
  return { container, registration, coordinator, log };
}

const A = "20260907T0545Z";
const B = "20260907T0700Z";
const C = "20260907T1143Z";

describe("one consent → bounded session → converged on C in two reloads", () => {
  it("performs exactly two controlled reloads with no second member action", async () => {
    const store = memoryStorage();
    const reloads = { count: 0 };

    /* ---- document 1: build A, worker for B waiting, C is published ---- */
    const d1 = documentHarness({ runningBuild: A, remoteBuild: C, store, reloads });
    d1.registration.waiting = makeWorker("installed");
    d1.registration.fireUpdateFound();
    expect(d1.coordinator.shouldPrompt()).toBe(true);

    // The member consents ONCE.
    const sessionId = startUpdateSession(store);
    expect(d1.coordinator.applyUpdate()).toBe("activating");

    // B activates and this document reloads exactly once.
    d1.container.changeController();
    d1.container.changeController();
    expect(reloads.count).toBe(1);
    expect(readSessionReloads(store)).toBe(1);

    // Authentication restoration is protected across the transition.
    expect(
      classifyAuthGate({
        loading: true,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: false,
      }),
    ).toBe("restoring");

    /* ---- document 2: booted on intermediate build B; C still published ---- */
    const d2 = documentHarness({ runningBuild: B, remoteBuild: C, store, reloads });
    // The session marker survived the reload.
    expect(isUpdateSessionActive(store)).toBe(true);
    expect(updateSessionId(store)).toBe(sessionId);

    // C is detected and the client must NOT report "latest".
    await d2.coordinator.checkForUpdate("manual");
    expect(d2.coordinator.getState().status).not.toBe("latest");
    expect(d2.coordinator.getState().updateRequired).toBe(true);

    // One further controlled reload completes the session automatically.
    expect(
      classifyHandover({
        updateRequired: d2.coordinator.getState().updateRequired,
        sessionActive: isUpdateSessionActive(store),
        reloadsUsed: readSessionReloads(store),
        dirty: false,
        reloadRequested: d2.coordinator.getState().reloadRequested,
      }),
    ).toBe("auto-reload");
    expect(d2.coordinator.reloadIfSafe({ force: false })).toBe("reloaded");

    // HONEST TOTAL: two document reloads for one consent.
    expect(reloads.count).toBe(2);
    expect(readSessionReloads(store)).toBe(MAX_UPDATE_SESSION_RELOADS);

    /* ---- document 3: booted on C — converged, nothing more happens ---- */
    const d3 = documentHarness({ runningBuild: C, remoteBuild: C, store, reloads });
    await d3.coordinator.checkForUpdate("manual");
    expect(d3.coordinator.getState().updateRequired).toBe(false);
    endUpdateSession(store);
    expect(isUpdateSessionActive(store)).toBe(false);
    expect(reloads.count).toBe(2);
  });

  it("cancels automatic completion when the member has unsaved work", async () => {
    const store = memoryStorage();
    const reloads = { count: 0 };
    startUpdateSession(store);
    noteSessionReload(store); // consent reload already spent

    const d = documentHarness({
      runningBuild: B,
      remoteBuild: C,
      store,
      reloads,
      dirty: () => true,
    });
    await d.coordinator.checkForUpdate("manual");
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: true,
        reloadsUsed: readSessionReloads(store),
        dirty: true,
      }),
    ).toBe("prompt");
    expect(d.coordinator.reloadIfSafe({ force: false })).toBe("blocked");
    expect(reloads.count).toBe(0);
  });

  it("never loops when the origin does not converge", async () => {
    const store = memoryStorage();
    const reloads = { count: 0 };
    startUpdateSession(store);
    noteSessionReload(store);
    noteSessionReload(store); // budget fully spent

    const d = documentHarness({ runningBuild: B, remoteBuild: C, store, reloads });
    await d.coordinator.checkForUpdate("manual");
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: true,
        reloadsUsed: readSessionReloads(store),
        dirty: false,
      }),
    ).toBe("prompt");
    expect(reloads.count).toBe(0);
  });

  it("never reloads a document whose member never consented", async () => {
    const store = memoryStorage();
    const reloads = { count: 0 };
    const d = documentHarness({ runningBuild: B, remoteBuild: C, store, reloads });
    await d.coordinator.checkForUpdate("manual");
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: isUpdateSessionActive(store),
        reloadsUsed: 0,
        dirty: false,
      }),
    ).toBe("prompt");
    expect(reloads.count).toBe(0);
  });

  it("does not reload when activation is merely delayed", () => {
    const store = memoryStorage();
    const reloads = { count: 0 };
    startUpdateSession(store);
    const d = documentHarness({ runningBuild: A, remoteBuild: C, store, reloads });
    d.registration.waiting = makeWorker("installed");
    d.registration.fireUpdateFound();
    expect(d.coordinator.applyUpdate()).toBe("activating");
    // The browser holds the promotion: no controller change, so no reload.
    expect(reloads.count).toBe(0);
    expect(readSessionReloads(store)).toBe(0);
  });
});
