/**
 * WO-145P — convergence to the LATEST published build, not merely to "some
 * newer build".
 *
 * Physical failure this exists for
 * -------------------------------
 * An installed iOS client running build A (`20260906T0904Z`) already had the
 * build-B worker (`20260907T0545Z`) installed and waiting from the previous
 * release. Build C (`20260907T0700Z`) was published afterwards. The member
 * pressed "Check for updates" once; the reload promoted the *waiting* worker —
 * B, the intermediate release — because that is the only worker the browser can
 * promote. B predates the WO-145O correction, so B then said "You're on the
 * latest version." while C was published: an intermediate build declared
 * current.
 *
 * The browser cannot be told "skip B and install C": a registration has at most
 * one waiting worker. So the application must instead *converge in hops* and
 * stay honest at every hop:
 *
 *   1. every activation/reload is followed by a fresh remote-marker check;
 *   2. a document that booted from an update reload and still finds a newer
 *      published build reports "one more update to install" — never "latest";
 *   3. the hop count is bounded, so a genuinely non-converging chain is reported
 *      honestly instead of asking the member to keep pressing a button.
 *
 * Storage is session-scoped and holds two non-identifying counters. No auth
 * material, no member data, nothing is ever cleared or unregistered here.
 */

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** This document was loaded by an update reload (kept until convergence). */
export const UPDATE_RELOAD_KEY = "veggiemeet_update_reload";
/** How many consecutive update hops have been taken without converging. */
export const UPDATE_HOPS_KEY = "veggiemeet_update_hops";

/**
 * Three hops cover every real chain (a client can only be behind by the number
 * of releases published while it slept, and each hop lands one release forward).
 * Beyond that the honest answer is "this isn't converging", not another prompt.
 */
export const MAX_CONVERGENCE_HOPS = 3;

/** Called immediately before an update-driven reload. */
export function markUpdateReload(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const next = readHops(storage) + 1;
    storage.setItem(UPDATE_RELOAD_KEY, "1");
    storage.setItem(UPDATE_HOPS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

/** True when this document was booted by an update reload. Non-destructive. */
export function bootedFromUpdateReload(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(UPDATE_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

export function readHops(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(UPDATE_HOPS_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** The client is provably running the published build: the chain is closed. */
export function noteConverged(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(UPDATE_RELOAD_KEY);
    storage.removeItem(UPDATE_HOPS_KEY);
  } catch {
    /* private mode: convergence simply degrades to per-check honesty */
  }
}

export type ConvergenceVerdict =
  /** Running build equals the published build. */
  | "converged"
  /** A newer published build exists; this document came from an update reload. */
  | "further-update"
  /** A newer published build exists and no update reload preceded this one. */
  | "update-available"
  /** Hops exhausted: report honestly, never loop the member. */
  | "stalled"
  /** The published build could not be proven (offline/failed): say so. */
  | "unknown";

export function classifyConvergence(input: {
  running: string | null;
  remote: string | null;
  bootedFromUpdate: boolean;
  hops: number;
}): ConvergenceVerdict {
  const { running, remote, bootedFromUpdate, hops } = input;
  if (!remote || !running) return "unknown";
  if (remote === running) return "converged";
  if (!bootedFromUpdate) return "update-available";
  return hops >= MAX_CONVERGENCE_HOPS ? "stalled" : "further-update";
}
