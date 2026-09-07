import { describe, expect, it, vi } from "vitest";
import {
  UpdateCoordinator,
  type ContainerLike,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/pwaUpdate";
import { fetchDeployedBuildId } from "@/lib/buildFreshness";

/**
 * WO-145O — the installed iPhone PWA ran build 20260906T0904Z while the origin
 * served 20260907T0545Z, and Settings still claimed "You're on the latest
 * version.". Two causes, both covered here:
 *
 *  1. the check spoke only from `registration.update()`, which observed a
 *     cache-served worker script and never fired `updatefound`;
 *  2. the UI declared "latest" as soon as the call returned — including for a
 *     failed or offline check.
 *
 * A "latest" outcome now requires a freshly proven remote build id equal to the
 * running one AND no installing/waiting worker.
 */

const RUNNING = "20260906T0904Z";
const DEPLOYED = "20260907T0545Z";

function makeWorker(state = "installed"): WorkerLike {
  const listeners: (() => void)[] = [];
  return {
    state,
    postMessage: () => {},
    addEventListener: (_t, l) => listeners.push(l),
  };
}

function harness(options: {
  remote?: string | null;
  updateThrows?: boolean;
  waiting?: boolean;
}) {
  const container: ContainerLike = {
    controller: makeWorker("activated"),
    addEventListener: () => {},
  };
  const registration: RegistrationLike = {
    installing: null,
    waiting: options.waiting ? makeWorker("installed") : null,
    active: makeWorker("activated"),
    update: vi.fn(async () => {
      if (options.updateThrows) throw new Error("offline");
    }),
    addEventListener: () => {},
  };
  const fetchRemoteBuildId = vi.fn(async () =>
    options.remote === undefined ? DEPLOYED : options.remote,
  );
  const coordinator = new UpdateCoordinator({
    container,
    reload: vi.fn(),
    now: () => 1_000,
    log: vi.fn(),
    hasUnsavedWork: () => false,
    runningBuildId: RUNNING,
    fetchRemoteBuildId,
  });
  coordinator.attach(registration);
  return { coordinator, registration, fetchRemoteBuildId };
}

describe("WO-145O — false-latest update detection", () => {
  it("reports latest only when the origin genuinely serves the running build", async () => {
    const h = harness({ remote: RUNNING });
    await h.coordinator.checkForUpdate("manual");
    expect(h.coordinator.getState().lastCheckOutcome).toBe("latest");
    expect(h.coordinator.getState().remoteBuildId).toBe(RUNNING);
  });

  it("detects the successor build even when no worker update event fires", async () => {
    const h = harness({ remote: DEPLOYED });
    await h.coordinator.checkForUpdate("manual");
    const s = h.coordinator.getState();
    expect(s.lastCheckOutcome).toBe("update-available");
    // Converges through the existing member-consented, single-reload path.
    expect(s.updateRequired).toBe(true);
    expect(s.status).toBe("update-required");
  });

  it("detects a waiting worker as an available update", async () => {
    const h = harness({ remote: RUNNING, waiting: true });
    await h.coordinator.checkForUpdate("manual");
    const s = h.coordinator.getState();
    expect(s.lastCheckOutcome).toBe("update-available");
    expect(h.coordinator.hasWaitingWorker()).toBe(true);
  });

  it("never reports latest when the remote build cannot be proven", async () => {
    const offline = harness({ remote: null });
    await offline.coordinator.checkForUpdate("manual");
    expect(offline.coordinator.getState().lastCheckOutcome).toBe("failed");

    const broken = harness({ remote: null, updateThrows: true });
    await broken.coordinator.checkForUpdate("manual");
    expect(broken.coordinator.getState().lastCheckOutcome).toBe("failed");
  });

  it("keeps repeated manual checks idempotent", async () => {
    const h = harness({ remote: RUNNING });
    await h.coordinator.checkForUpdate("manual");
    await h.coordinator.checkForUpdate("manual");
    await h.coordinator.checkForUpdate("manual");
    expect(h.coordinator.getState().lastCheckOutcome).toBe("latest");
    expect(h.coordinator.getState().updateRequired).toBe(false);
    expect(h.fetchRemoteBuildId).toHaveBeenCalledTimes(3);
  });

  it("a postponed build is re-offered by a later manual check", async () => {
    const h = harness({ remote: RUNNING, waiting: true });
    await h.coordinator.checkForUpdate("manual");
    h.coordinator.dismiss();
    expect(h.coordinator.shouldPrompt()).toBe(false);
    await h.coordinator.checkForUpdate("manual");
    expect(h.coordinator.shouldPrompt()).toBe(true);
  });

  it("consults the remote authority on foreground/launch checks too", async () => {
    const h = harness({ remote: DEPLOYED });
    await h.coordinator.checkForUpdate("launch");
    expect(h.fetchRemoteBuildId).toHaveBeenCalled();
    expect(h.coordinator.getState().lastCheckOutcome).toBe("update-available");
  });
});

describe("WO-145O — /version.json is never answered from a cache", () => {
  it("requests a unique URL with explicit revalidation and no-store", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return {
        ok: true,
        json: async () => ({ buildId: DEPLOYED }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    expect(await fetchDeployedBuildId(fetchFn, () => 111)).toBe(DEPLOYED);
    const [url, init] = calls[0];
    expect(url).toBe("/version.json?_=111");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toMatchObject({ "cache-control": "no-cache" });
  });

  it("resolves null for a non-OK or unparseable response", async () => {
    const notOk = (async () => ({ ok: false }) as unknown as Response) as unknown as typeof fetch;
    expect(await fetchDeployedBuildId(notOk)).toBeNull();
    const garbage = (async () =>
      ({ ok: true, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    expect(await fetchDeployedBuildId(garbage)).toBeNull();
  });
});
