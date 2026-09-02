/**
 * WO-145B — stale-chunk recovery proofs. The two properties that matter: a
 * member never sees a blank screen, and the client never reloads in a loop.
 */
import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, recoverFromChunkFailure } from "@/lib/chunkRecovery";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

describe("isChunkLoadError", () => {
  it("matches the real browser and Vite messages", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://app/assets/Host-abc.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
      "ChunkLoadError: Loading chunk 12 failed",
    ]) {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    }
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("recoverFromChunkFailure", () => {
  it("reloads once and records the build it recovered onto", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    const outcome = recoverFromChunkFailure({
      storage,
      buildId: "b2",
      reload,
      onUpdateRequired,
    });
    expect(outcome).toBe("reloaded");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onUpdateRequired).not.toHaveBeenCalled();
    expect(storage.dump()).toMatchObject({ veggiemeet_chunk_recovery: "b2" });
  });

  it("never loops: a second failure on the same build asks the member instead", () => {
    const storage = memoryStorage({ veggiemeet_chunk_recovery: "b2" });
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    const outcome = recoverFromChunkFailure({
      storage,
      buildId: "b2",
      reload,
      onUpdateRequired,
    });
    expect(outcome).toBe("update-required");
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateRequired).toHaveBeenCalledTimes(1);
  });

  it("allows one fresh recovery after a genuinely new build", () => {
    const storage = memoryStorage({ veggiemeet_chunk_recovery: "b1" });
    const reload = vi.fn();
    expect(
      recoverFromChunkFailure({
        storage,
        buildId: "b2",
        reload,
        onUpdateRequired: vi.fn(),
      }),
    ).toBe("reloaded");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("degrades safely without storage (private mode): prompt, never loop", () => {
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    expect(
      recoverFromChunkFailure({
        storage: null,
        buildId: "b2",
        reload,
        onUpdateRequired,
      }),
    ).toBe("update-required");
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateRequired).toHaveBeenCalled();
  });
});
