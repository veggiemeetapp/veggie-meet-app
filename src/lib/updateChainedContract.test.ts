import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  UpdateCoordinator,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";
import {
  MAX_CONVERGENCE_HOPS,
  UPDATE_HOPS_KEY,
  UPDATE_RELOAD_KEY,
  bootedFromUpdateReload,
  classifyConvergence,
  markUpdateReload,
  noteConverged,
  readHops,
  type StorageLike,
} from "@/lib/updateConvergence";

/**
 * WO-145P CORRECTION — the physical intermediate landing observed on the
 * installed iPhone (build A `20260906T0904Z` → intermediate B `20260907T0545Z`
 * while C `20260907T0700Z` was published, then a false "latest") cannot be
 * reproduced naturally in desktop Chromium: navigations are NetworkFirst, so a
 * promoted worker always yields the published shell. Certification therefore
 * rests on the physical recording plus these deterministic state tests, which
 * pin every chained-update transition the correction depends on.
 */

const A = "20260906T0904Z";
const B = "20260907T0545Z";
const C = "20260907T0700Z";

function worker(state = "installed"): WorkerLike {
  return { state, postMessage: () => {}, addEventListener: () => {} };
}

function memoryStore(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function harness(options: {
  running: string;
  remote: string | null;
  waiting?: boolean;
  bootedFromUpdate?: boolean;
  hops?: number;
}) {
  let controllerChange = () => {};
  const container: ContainerLike = {
    controller: worker("activated"),
    addEventListener: (_type, listener) => {
      controllerChange = listener;
    },
  };
  const waiting = options.waiting === false ? null : worker("installed");
  const registration: RegistrationLike = {
    installing: null,
    waiting,
    active: worker("activated"),
    update: vi.fn(async () => {}),
    addEventListener: () => {},
  };
  const reload = vi.fn();
  const onConverged = vi.fn();
  const coordinator = new UpdateCoordinator({
    container,
    reload,
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
  return { coordinator, reload, onConverged, fireControllerChange: () => controllerChange() };
}

describe("WO-145P — a booted-from-update document never reports latest", () => {
  it("classifies a newer remote build as a further update, never converged", () => {
    expect(
      classifyConvergence({ running: B, remote: C, bootedFromUpdate: true, hops: 1 }),
    ).toBe("further-update");
    expect(
      classifyConvergence({ running: C, remote: C, bootedFromUpdate: true, hops: 2 }),
    ).toBe("converged");
  });

  it("reports the chained update in state instead of latest", async () => {
    const h = harness({ running: B, remote: C, bootedFromUpdate: true, hops: 1 });
    await h.coordinator.checkForUpdate("launch");
    const s = h.coordinator.getState();
    expect(s.lastCheckOutcome).toBe("update-available");
    expect(s.lastCheckOutcome).not.toBe("latest");
    expect(s.chainedUpdate).toBe(true);
    expect(h.onConverged).not.toHaveBeenCalled();
  });

  it("shows the exact 'One more update to install' member copy", () => {
    const settings = readFileSync("src/screens/Settings.tsx", "utf8");
    expect(settings).toContain(
      "One more update to install. VeggieMeet installed an in-between version first.",
    );
    const prompt = readFileSync("src/components/app/UpdatePrompt.tsx", "utf8");
    expect(prompt).toContain("One more update to install");
  });

  it("produces an honest recovery message at the hop ceiling", async () => {
    const h = harness({
      running: B,
      remote: C,
      bootedFromUpdate: true,
      hops: MAX_CONVERGENCE_HOPS,
    });
    await h.coordinator.checkForUpdate("manual");
    expect(h.coordinator.getState().convergenceStalled).toBe(true);
    expect(h.coordinator.getState().lastCheckOutcome).not.toBe("latest");
    const settings = readFileSync("src/screens/Settings.tsx", "utf8");
    expect(settings).toContain("VeggieMeet keeps landing on an in-between version.");
  });
});

describe("WO-145P — one reload per consent", () => {
  it("reloads at most once however many controller changes arrive", () => {
    const h = harness({ running: A, remote: C });
    expect(h.coordinator.applyUpdate()).toBe("activating");
    h.fireControllerChange();
    h.fireControllerChange();
    h.fireControllerChange();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads without consent", () => {
    const h = harness({ running: A, remote: C });
    h.fireControllerChange();
    expect(h.reload).not.toHaveBeenCalled();
  });
});

describe("WO-145P — the hop marker", () => {
  it("increments once per update-driven reload", () => {
    const store = memoryStore();
    expect(markUpdateReload(store)).toBe(1);
    expect(markUpdateReload(store)).toBe(2);
    expect(readHops(store)).toBe(2);
    expect(bootedFromUpdateReload(store)).toBe(true);
  });

  it("clears only once the running build equals the published build", async () => {
    const store = memoryStore({ [UPDATE_RELOAD_KEY]: "1", [UPDATE_HOPS_KEY]: "1" });

    // Still behind: the marker survives.
    const behind = harness({ running: B, remote: C, bootedFromUpdate: true, hops: 1 });
    await behind.coordinator.checkForUpdate("launch");
    expect(behind.onConverged).not.toHaveBeenCalled();
    expect(bootedFromUpdateReload(store)).toBe(true);

    // Equal: the chain closes and the markers are removed.
    const equal = harness({
      running: C,
      remote: C,
      waiting: false,
      bootedFromUpdate: true,
      hops: 2,
    });
    await equal.coordinator.checkForUpdate("launch");
    expect(equal.coordinator.getState().lastCheckOutcome).toBe("latest");
    expect(equal.onConverged).toHaveBeenCalledTimes(1);
    noteConverged(store);
    expect(bootedFromUpdateReload(store)).toBe(false);
    expect(readHops(store)).toBe(0);
  });
});

describe("WO-145P — a timed-out check is never latest", () => {
  it("fails honestly when the remote marker never answers", async () => {
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

describe("WO-145P — no destructive or unconsented mechanism is introduced", () => {
  const sources = [
    "src/lib/pwaUpdate.ts",
    "src/hooks/usePwaUpdate.tsx",
    "src/lib/updateConvergence.ts",
    "src/lib/buildFreshness.ts",
    "src/screens/Settings.tsx",
    "src/components/app/UpdatePrompt.tsx",
  ].map((path) => [path, readFileSync(path, "utf8")] as const);

  it("contains no clientsClaim, unregister(), sign-out or storage clearing", () => {
    for (const [path, source] of sources) {
      expect(source, path).not.toMatch(/clientsClaim\s*:\s*true/);
      expect(source, path).not.toMatch(/\.unregister\s*\(/);
      if (path !== "src/screens/Settings.tsx")
        expect(source, path).not.toMatch(/signOut\s*\(/); // Settings legitimately hosts Account sign out
      expect(source, path).not.toMatch(/localStorage\.clear\s*\(/);
      expect(source, path).not.toMatch(/caches\.delete\s*\(/);
      expect(source, path).not.toMatch(/indexedDB\.deleteDatabase\s*\(/);
    }
  });

  it("touches no authentication or member-data module", () => {
    for (const [path, source] of sources) {
      if (path === "src/screens/Settings.tsx") continue; // the Settings screen legitimately reads the session
      expect(source, path).not.toContain("@/integrations/supabase/client");
    }
  });

  it("only ever stores the two non-identifying convergence counters", () => {
    const source = readFileSync("src/lib/updateConvergence.ts", "utf8");
    const keys = [...source.matchAll(/"(veggiemeet_[a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(
      new Set(["veggiemeet_update_reload", "veggiemeet_update_hops"]),
    );
  });
});
