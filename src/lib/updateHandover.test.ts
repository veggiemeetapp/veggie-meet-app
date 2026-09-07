/**
 * WO-145Q — regression cover for the second-reload defect: one consent produced
 * one reload, the returning document was still not the published build, and the
 * app raised "This window needs to update … Reload now"
 * (`app_update_build_mismatch{cause:"remote_build_mismatch"}` from 13:35:38Z).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  HANDOVER_CONSENT_KEY,
  HANDOVER_RELOADS_KEY,
  MAX_HANDOVER_AUTO_RELOADS,
  classifyHandover,
  clearConsent,
  hasConsent,
  noteAutoReload,
  readAutoReloads,
  recordConsent,
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

describe("WO-145Q consent-carried handover", () => {
  let store = memoryStorage();
  beforeEach(() => {
    store = memoryStorage();
  });

  it("records and clears consent without touching anything else", () => {
    recordConsent(store);
    expect(store.map.get(HANDOVER_CONSENT_KEY)).toBe("1");
    expect(hasConsent(store)).toBe(true);
    clearConsent(store);
    expect(hasConsent(store)).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it("completes a consented handover automatically exactly once", () => {
    recordConsent(store);
    expect(
      classifyHandover({
        updateRequired: true,
        consented: hasConsent(store),
        autoReloads: readAutoReloads(store),
        dirty: false,
      }),
    ).toBe("auto-reload");

    expect(noteAutoReload(store)).toBe(MAX_HANDOVER_AUTO_RELOADS);
    // The consent is consumed, so a non-converging origin cannot loop.
    expect(hasConsent(store)).toBe(false);
    expect(store.map.get(HANDOVER_RELOADS_KEY)).toBe("1");
    expect(
      classifyHandover({
        updateRequired: true,
        consented: hasConsent(store),
        autoReloads: readAutoReloads(store),
        dirty: false,
      }),
    ).toBe("prompt");
  });

  it("never reloads over unsaved work — it asks", () => {
    recordConsent(store);
    expect(
      classifyHandover({
        updateRequired: true,
        consented: true,
        autoReloads: 0,
        dirty: true,
      }),
    ).toBe("prompt");
  });

  it("never reloads without consent on record", () => {
    expect(
      classifyHandover({
        updateRequired: true,
        consented: false,
        autoReloads: 0,
        dirty: false,
      }),
    ).toBe("prompt");
  });

  it("does nothing when this client is not stale, or already reloading", () => {
    expect(
      classifyHandover({ updateRequired: false, consented: true, autoReloads: 0, dirty: false }),
    ).toBe("none");
    expect(
      classifyHandover({
        updateRequired: true,
        consented: true,
        autoReloads: 0,
        dirty: false,
        reloadRequested: true,
      }),
    ).toBe("none");
  });

  it("degrades to the explicit prompt when storage is unavailable", () => {
    recordConsent(null);
    expect(hasConsent(null)).toBe(false);
    expect(readAutoReloads(null)).toBe(0);
    expect(noteAutoReload(null)).toBe(0);
  });
});

describe("WO-145Q handover wiring", () => {
  const provider = readFileSync("src/hooks/usePwaUpdate.tsx", "utf8");

  it("records the consent before the update reload", () => {
    expect(provider).toMatch(/recordConsent\(updateSessionStore\(\)\)/);
  });

  it("completes the handover through the safe single-reload path", () => {
    expect(provider).toMatch(/classifyHandover\(\{/);
    expect(provider).toMatch(/coordinator\.reloadIfSafe\(\{ force: false \}\)/);
  });

  it("clears the consent once the client is proven current", () => {
    expect(provider).toMatch(/clearConsent\(store\)/);
  });

  it("adds no takeover mechanism", () => {
    expect(provider).not.toMatch(/clientsClaim/);
    expect(provider).not.toMatch(/registration\.unregister\(/);
  });
});
