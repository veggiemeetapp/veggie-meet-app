/**
 * WO-145Q CORRECTION — the bounded update session.
 *
 * Physical failure: one consent produced one reload, the returning document was
 * still not the published build, and the app raised "This window needs to update
 * … Reload now" (`app_update_build_mismatch{cause:"remote_build_mismatch"}` from
 * 13:35:38Z).
 *
 * Honest contract pinned here: one "Update now" authorises AT MOST TWO
 * controlled document reloads in total — the consent reload plus one automatic
 * completion reload — subject to unsaved-work and multi-window safety.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  MAX_AUTOMATIC_COMPLETION_RELOADS,
  MAX_UPDATE_SESSION_RELOADS,
  UPDATE_SESSION_KEY,
  UPDATE_SESSION_RELOADS_KEY,
  classifyHandover,
  endUpdateSession,
  isUpdateSessionActive,
  noteSessionReload,
  readSessionReloads,
  startUpdateSession,
  updateSessionId,
} from "@/lib/updateHandover";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("bounded update session budget", () => {
  let store = memoryStorage();
  beforeEach(() => {
    store = memoryStorage();
  });

  it("states the exact maximum: two controlled reloads per consent", () => {
    expect(MAX_UPDATE_SESSION_RELOADS).toBe(2);
    expect(MAX_AUTOMATIC_COMPLETION_RELOADS).toBe(1);
  });

  it("opens and closes a session without touching anything else", () => {
    const id = startUpdateSession(store, "upd-test");
    expect(id).toBe("upd-test");
    expect(store.map.get(UPDATE_SESSION_KEY)).toBe("upd-test");
    expect(store.map.get(UPDATE_SESSION_RELOADS_KEY)).toBe("0");
    expect(isUpdateSessionActive(store)).toBe(true);
    expect(updateSessionId(store)).toBe("upd-test");
    endUpdateSession(store);
    expect(isUpdateSessionActive(store)).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it("counts the consent reload, then permits exactly one completion reload", () => {
    startUpdateSession(store);

    // Reload 1 — the consent reload itself.
    expect(noteSessionReload(store)).toBe(1);

    // Landed on an intermediate build: the session completes itself once.
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: isUpdateSessionActive(store),
        reloadsUsed: readSessionReloads(store),
        dirty: false,
      }),
    ).toBe("auto-reload");

    // Reload 2 — the automatic completion. Total for this consent: TWO.
    expect(noteSessionReload(store)).toBe(MAX_UPDATE_SESSION_RELOADS);

    // Budget spent: a still-stale origin asks the member, it never loops.
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: isUpdateSessionActive(store),
        reloadsUsed: readSessionReloads(store),
        dirty: false,
      }),
    ).toBe("prompt");
  });

  it("never counts reloads outside an open session", () => {
    expect(noteSessionReload(store)).toBe(0);
    expect(readSessionReloads(store)).toBe(0);
  });

  it("never reloads over unsaved work — it asks", () => {
    startUpdateSession(store);
    noteSessionReload(store);
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: true,
        reloadsUsed: 1,
        dirty: true,
      }),
    ).toBe("prompt");
  });

  it("never reloads when no session is on record", () => {
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: false,
        reloadsUsed: 0,
        dirty: false,
      }),
    ).toBe("prompt");
  });

  it("does nothing when this client is not stale, or already reloading", () => {
    expect(
      classifyHandover({
        updateRequired: false,
        sessionActive: true,
        reloadsUsed: 1,
        dirty: false,
      }),
    ).toBe("none");
    expect(
      classifyHandover({
        updateRequired: true,
        sessionActive: true,
        reloadsUsed: 1,
        dirty: false,
        reloadRequested: true,
      }),
    ).toBe("none");
  });

  it("degrades to the explicit prompt when storage is unavailable", () => {
    expect(startUpdateSession(null).startsWith("upd-")).toBe(true);
    expect(isUpdateSessionActive(null)).toBe(false);
    expect(readSessionReloads(null)).toBe(0);
    expect(noteSessionReload(null)).toBe(0);
  });
});

describe("update-session wiring", () => {
  const provider = readFileSync("src/hooks/usePwaUpdate.tsx", "utf8");

  it("opens the session on the member's consent", () => {
    expect(provider).toMatch(/startUpdateSession\(updateSessionStore\(\)\)/);
  });

  it("counts every controlled reload, including the consent reload", () => {
    expect(provider).toMatch(/noteSessionReload\(store\)/);
  });

  it("completes the session through the safe single-reload path", () => {
    expect(provider).toMatch(/classifyHandover\(\{/);
    expect(provider).toMatch(/coordinator\.reloadIfSafe\(\{ force: false \}\)/);
  });

  it("enforces the ceiling independently of the decision function", () => {
    expect(provider).toMatch(/readSessionReloads\(store\) >= MAX_UPDATE_SESSION_RELOADS/);
  });

  it("ends the session once the client is proven current", () => {
    expect(provider).toMatch(/endUpdateSession\(store\)/);
  });

  it("adds no takeover mechanism", () => {
    expect(provider).not.toMatch(/clientsClaim/);
    expect(provider).not.toMatch(/registration\.unregister\(/);
  });
});
