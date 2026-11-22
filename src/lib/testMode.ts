import { useSyncExternalStore } from "react";

/**
 * Owner "Test mode" — a per-device switch that makes new feature surfaces
 * (currently: Collection) render sample data instead of calling the backend,
 * so the owner can review UI without walking the whole real-world flow.
 *
 * Rules:
 *  - Only the owner sees the toggle (You header, next to the theme switch).
 *  - While on, the Collection hooks never write to the server; mutations act
 *    on the in-memory sample so Add / Hide / Remove still feel real.
 *  - Stored in localStorage as a per-viewer convenience; a cleared browser
 *    simply falls back to live data.
 */
const KEY = "vm.testMode";
const listeners = new Set<() => void>();

export function isTestModeEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setTestMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the in-memory listeners still fire */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTestMode(): boolean {
  return useSyncExternalStore(subscribe, isTestModeEnabled, () => false);
}
