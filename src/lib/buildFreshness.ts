/**
 * WO-145 — build identity and authenticated cache freshness.
 *
 * Two separate problems live here, both surfaced by the reported symptom:
 *
 *  1. Build identity. The client must be able to say which build it loaded, and
 *     which build the origin currently serves, so a "stale document" can be
 *     detected and reported instead of guessed at. `/version.json` is emitted at
 *     build time, excluded from the precache, and always fetched `no-store`.
 *
 *  2. Cache freshness across a build change. VeggieMeet keeps NO persisted
 *     React Query cache (memory only, cleared by any reload) and clears every
 *     query on account change, so a *reload* is sufficient for server data.
 *     What was missing was the case where a build changes underneath a client
 *     whose in-memory cache survives: after a new build takes control we
 *     invalidate the small set of critical authenticated queries by key, rather
 *     than clearing storage or touching auth tokens.
 *
 * Nothing here reads or writes auth tokens, drafts, or offline data.
 */
import { APP_VERSION } from "@/lib/appVersion";

/**
 * Bump ONLY when the shape of cached client data changes incompatibly.
 * A mismatch invalidates cached reads; it never clears auth or offline data.
 */
export const CACHE_SCHEMA_VERSION = "2";

const BUILD_KEY = "veggiemeet_build_id";
const SCHEMA_KEY = "veggiemeet_cache_schema";

/** Critical authenticated queries refetched after a build/schema change. */
export const CRITICAL_QUERY_KEYS: readonly string[] = [
  "profile",
  "my-settings",
  "my-you-summary",
  "today-experience",
  "today",
  "notifications",
  "notifications-unread-count",
  "my-plans",
  "veggie-network",
  "my-location-context",
  "meetup-membership",
];

export type FreshnessOutcome =
  | "first-run"
  | "unchanged"
  | "build-changed"
  | "schema-changed";

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** The build this JavaScript belongs to. Non-secret, build timestamp only. */
export const LOADED_BUILD_ID = APP_VERSION;

/**
 * Compare the stored build/schema markers with the running build and record the
 * new ones. Pure with respect to React Query: the caller decides what to do.
 */
export function reconcileBuildMarkers(
  storage: StorageLike | null,
  buildId: string = LOADED_BUILD_ID,
  schemaVersion: string = CACHE_SCHEMA_VERSION,
): FreshnessOutcome {
  if (!storage) return "unchanged";
  let previousBuild: string | null = null;
  let previousSchema: string | null = null;
  try {
    previousBuild = storage.getItem(BUILD_KEY);
    previousSchema = storage.getItem(SCHEMA_KEY);
  } catch {
    return "unchanged";
  }
  try {
    storage.setItem(BUILD_KEY, buildId);
    storage.setItem(SCHEMA_KEY, schemaVersion);
  } catch {
    /* private mode: freshness degrades to per-reload, never to an error */
  }

  if (previousBuild === null) return "first-run";
  if (previousSchema !== schemaVersion) return "schema-changed";
  if (previousBuild !== buildId) return "build-changed";
  return "unchanged";
}

export interface InvalidatorLike {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
}

/**
 * Targeted refetch — never a blanket cache wipe, so unrelated cached reads,
 * auth state, drafts and intentional offline data all survive.
 */
export function invalidateCriticalQueries(client: InvalidatorLike): number {
  let n = 0;
  for (const key of CRITICAL_QUERY_KEYS) {
    client.invalidateQueries({ queryKey: [key] });
    n += 1;
  }
  return n;
}

/** The build id the origin currently serves, or null when unknown/offline. */
export async function fetchDeployedBuildId(
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { buildId?: unknown };
    return typeof body.buildId === "string" && body.buildId ? body.buildId : null;
  } catch {
    return null;
  }
}

/** True when the origin serves a different build than this document loaded. */
export function isBuildMismatch(
  deployedBuildId: string | null,
  loaded: string = LOADED_BUILD_ID,
): boolean {
  return !!deployedBuildId && deployedBuildId !== loaded;
}
