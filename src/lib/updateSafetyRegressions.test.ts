/**
 * WO-145R — the four release-blocking safety properties, proven separately.
 *
 *  1. an expired / revoked / removed session reaches the normal signed-out
 *     experience, while an inconclusive restoration stays safe;
 *  2. a cancelled or failed update restores realtime without a manual reload;
 *  3. a stale consent can never arm a later reload;
 *  4. (chunk recovery lives in chunkRecovery.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAuthGate } from "@/lib/authHydration";
import { classifyRestoration } from "@/lib/authRestorationOutcome";
import {
  MAX_UPDATE_SESSION_RELOADS,
  UPDATE_SESSION_MAX_AGE_MS,
  classifyHandover,
  endUpdateSession,
  isUpdateSessionActive,
  isUpdateSessionExpired,
  noteSessionReload,
  startUpdateSession,
} from "@/lib/updateHandover";
import { beginQuiesce, endQuiesce, resetQuiesceState } from "@/lib/updateQuiesce";
import { readRealtimeEpoch, resetRealtimeEpoch } from "@/lib/realtimeEpoch";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    size: () => map.size,
  };
}

/* ---------------- 1. authentication restoration ---------------- */

describe("WO-145R rejected sessions never trap the member", () => {
  it("an expired refresh token is conclusive: the signed-out experience is reachable", () => {
    const outcome = classifyRestoration({
      hasSession: false,
      error: { status: 400, code: "refresh_token_not_found" },
      persistedToken: true,
    });
    expect(outcome).toBe("rejected");
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: false,
        graceElapsed: true,
        sessionRejected: true,
      }),
    ).toBe("signed-out");
  });

  it("a revoked session (401) is conclusive", () => {
    expect(
      classifyRestoration({
        hasSession: false,
        error: { status: 401, message: "Invalid Refresh Token" },
        persistedToken: true,
      }),
    ).toBe("rejected");
  });

  it("a session missing from storage is conclusive", () => {
    expect(
      classifyRestoration({ hasSession: false, error: null, persistedToken: false }),
    ).toBe("rejected");
  });

  it("an offline restoration is inconclusive and stays on the safe delayed state", () => {
    expect(
      classifyRestoration({
        hasSession: false,
        error: { name: "TypeError", message: "Failed to fetch" },
        persistedToken: true,
      }),
    ).toBe("inconclusive");
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: true,
      }),
    ).toBe("delayed");
  });

  it("a 5xx restoration is inconclusive and never exposes onboarding", () => {
    expect(
      classifyRestoration({
        hasSession: false,
        error: { status: 503 },
        persistedToken: true,
      }),
    ).toBe("inconclusive");
    for (const graceElapsed of [false, true]) {
      expect(
        classifyAuthGate({
          loading: false,
          hasSession: false,
          profileResolved: false,
          persistedToken: true,
          graceElapsed,
        }),
      ).not.toBe("signed-out");
    }
  });

  it("a successful retry restores the authenticated experience", () => {
    expect(
      classifyRestoration({ hasSession: true, error: null, persistedToken: true }),
    ).toBe("restored");
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: true,
        profileResolved: true,
        persistedToken: true,
        graceElapsed: true,
      }),
    ).toBe("authenticated");
  });

  it("explicit sign-out remains immediately conclusive", () => {
    expect(
      classifyAuthGate({
        loading: true,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: false,
        explicitSignOut: true,
      }),
    ).toBe("signed-out");
  });
});

/* ---------------- 2. cancelled-update realtime recovery ---------------- */

describe("WO-145R a cancelled update restores live connections", () => {
  beforeEach(() => {
    resetQuiesceState();
    resetRealtimeEpoch();
  });

  it("reconnects the socket and asks every owner to resubscribe exactly once", () => {
    const realtime = { disconnect: vi.fn(), connect: vi.fn() };
    const client = { removeAllChannels: vi.fn(), realtime };
    const before = readRealtimeEpoch();

    beginQuiesce("txn-1", { realtimeClient: client });
    expect(client.removeAllChannels).toHaveBeenCalledTimes(1);
    expect(realtime.disconnect).toHaveBeenCalledTimes(1);
    // Quiescing must not itself trigger a resubscribe.
    expect(readRealtimeEpoch()).toBe(before);

    expect(endQuiesce("txn-1", { realtimeClient: client })).toBe("restored");
    expect(realtime.connect).toHaveBeenCalledTimes(1);
    // Exactly one epoch bump → exactly one resubscribe per owner, no duplicates.
    expect(readRealtimeEpoch()).toBe(before + 1);
  });

  it("is idempotent: a second cancellation creates no duplicate subscriptions", () => {
    const client = { removeAllChannels: vi.fn(), realtime: { disconnect: vi.fn(), connect: vi.fn() } };
    beginQuiesce("txn-2", { realtimeClient: client });
    endQuiesce("txn-2", { realtimeClient: client });
    const after = readRealtimeEpoch();
    expect(endQuiesce("txn-2", { realtimeClient: client })).toBe("noop");
    expect(readRealtimeEpoch()).toBe(after);
  });
});

/* ---------------- 3. stale update consent ---------------- */

describe("WO-145R a stale consent cannot reload later", () => {
  it("expires after the session boundary", () => {
    const store = memoryStore();
    const t0 = 1_000_000;
    startUpdateSession(store, "upd-a", t0);
    expect(isUpdateSessionActive(store, t0 + 1_000)).toBe(true);
    expect(isUpdateSessionExpired(store, t0 + UPDATE_SESSION_MAX_AGE_MS + 1)).toBe(true);
  });

  it("an expired consent is closed on read and cannot authorize a reload", () => {
    const store = memoryStore();
    const t0 = 5_000_000;
    startUpdateSession(store, "upd-b", t0);
    const later = t0 + UPDATE_SESSION_MAX_AGE_MS + 60_000;
    expect(isUpdateSessionActive(store, later)).toBe(false);
    // Closed: nothing of the consent survives to arm a background reload.
    expect(store.size()).toBe(0);
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: isUpdateSessionActive(store, later),
        reloadsUsed: 1,
        dirty: false,
      }),
    ).toBe("prompt");
  });

  it("an explicitly ended session (blocked / cancelled / failed) prompts instead", () => {
    const store = memoryStore();
    startUpdateSession(store, "upd-c", 10);
    endUpdateSession(store);
    expect(isUpdateSessionActive(store, 20)).toBe(false);
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: false,
        reloadsUsed: 0,
        dirty: false,
      }),
    ).toBe("prompt");
  });

  it("unsaved work still cancels automatic completion inside a valid session", () => {
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: true,
        reloadsUsed: 1,
        dirty: true,
      }),
    ).toBe("prompt");
  });

  it("a valid consent still completes within the two-reload budget", () => {
    const store = memoryStore();
    const t0 = 9_000_000;
    startUpdateSession(store, "upd-d", t0);
    expect(noteSessionReload(store)).toBe(1); // the consent reload
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: isUpdateSessionActive(store, t0 + 5_000),
        reloadsUsed: 1,
        dirty: false,
      }),
    ).toBe("auto-reload");
    expect(noteSessionReload(store)).toBe(2); // the completion reload
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: true,
        reloadsUsed: MAX_UPDATE_SESSION_RELOADS,
        dirty: false,
      }),
    ).toBe("prompt");
  });
});
