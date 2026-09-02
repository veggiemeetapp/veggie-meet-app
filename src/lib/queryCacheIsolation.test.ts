/**
 * WO-145B — authenticated cache correctness proofs.
 *
 * 1. No persistence: the repository contains no React Query persister, so the
 *    cache is memory-only and cannot survive a reload. There is therefore no
 *    persisted cache key and no maximum persisted age to bound.
 * 2. Account partitioning: an account change removes the previous account's
 *    protected reads rather than merely invalidating them.
 * 3. Same-build freshness: session-critical reads refresh on resume even when
 *    the build id has not changed.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CRITICAL_QUERY_KEYS,
  RESUME_REFRESH_QUERY_KEYS,
  reconcileAccountMarker,
  refreshSessionCriticalQueries,
  removeProtectedQueries,
} from "@/lib/buildFreshness";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("cache persistence", () => {
  it("has no React Query persistence anywhere in src", () => {
    const offenders = walk("src").filter((file) => {
      if (file.endsWith("queryCacheIsolation.test.ts")) return false;
      const source = readFileSync(file, "utf8");
      return /persistQueryClient|createSyncStoragePersister|createAsyncStoragePersister|PersistQueryClientProvider/.test(
        source,
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe("account partitioning", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it("detects an account change", () => {
    const storage = memoryStorage({ veggiemeet_cache_account: "user-a" });
    expect(reconcileAccountMarker(storage, "user-b")).toBe("account-changed");
    expect(reconcileAccountMarker(storage, "user-b")).toBe("same-account");
  });

  it("treats a first run as neutral", () => {
    expect(reconcileAccountMarker(memoryStorage(), "user-a")).toBe("first-run");
  });

  it("removes (not just invalidates) protected reads on an account change", () => {
    const removeQueries = vi.fn();
    const count = removeProtectedQueries({ removeQueries });
    expect(count).toBe(CRITICAL_QUERY_KEYS.length);
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ["profile"] });
  });
});

describe("same-build freshness", () => {
  it("refreshes session-critical reads without a build change", () => {
    const invalidateQueries = vi.fn();
    const count = refreshSessionCriticalQueries({ invalidateQueries });
    expect(count).toBe(RESUME_REFRESH_QUERY_KEYS.length);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["profile"] });
  });
});
