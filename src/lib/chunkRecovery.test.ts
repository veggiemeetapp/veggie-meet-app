/**
 * WO-145B / WO-145R — stale-chunk recovery proofs. The properties that matter:
 * a member never sees a blank screen, the client never reloads in a loop, and a
 * transient network failure never destroys unfinished member work.
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

/** A confirmed genuine stale build (the origin serves something else). */
const mismatch = async () => true;

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
  it("reloads once and records the build it recovered onto", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    const outcome = await recoverFromChunkFailure({
      storage,
      buildId: "b2",
      reload,
      onUpdateRequired,
      confirmBuildMismatch: mismatch,
    });
    expect(outcome).toBe("reloaded");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onUpdateRequired).not.toHaveBeenCalled();
    expect(storage.dump()).toMatchObject({ veggiemeet_chunk_recovery: "b2" });
  });

  it("never loops: a second failure on the same build asks the member instead", async () => {
    const storage = memoryStorage({ veggiemeet_chunk_recovery: "b2" });
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    const outcome = await recoverFromChunkFailure({
      storage,
      buildId: "b2",
      reload,
      onUpdateRequired,
      confirmBuildMismatch: mismatch,
    });
    expect(outcome).toBe("update-required");
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateRequired).toHaveBeenCalledTimes(1);
  });

  it("allows one fresh recovery after a genuinely new build", async () => {
    const storage = memoryStorage({ veggiemeet_chunk_recovery: "b1" });
    const reload = vi.fn();
    await expect(
      recoverFromChunkFailure({
        storage,
        buildId: "b2",
        reload,
        onUpdateRequired: vi.fn(),
        confirmBuildMismatch: mismatch,
      }),
    ).resolves.toBe("reloaded");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("degrades safely without storage (private mode): prompt, never loop", async () => {
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    await expect(
      recoverFromChunkFailure({
        storage: null,
        buildId: "b2",
        reload,
        onUpdateRequired,
        confirmBuildMismatch: mismatch,
      }),
    ).resolves.toBe("update-required");
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateRequired).toHaveBeenCalled();
  });

  /* ---------------- WO-145R ---------------- */

  it("never reloads while a Meetup draft or unsent message is unfinished", async () => {
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    const onRecoveryChoice = vi.fn();
    const outcome = await recoverFromChunkFailure({
      storage: memoryStorage(),
      buildId: "b2",
      reload,
      onUpdateRequired,
      onRecoveryChoice,
      hasUnsavedWork: () => true,
      confirmBuildMismatch: mismatch,
    });
    expect(outcome).toBe("deferred-unsaved-work");
    expect(reload).not.toHaveBeenCalled();
    expect(onRecoveryChoice).toHaveBeenCalledTimes(1);
    // The member still gets a recoverable, honest state.
    expect(onUpdateRequired).toHaveBeenCalledTimes(1);
  });

  it("treats a temporary connectivity failure as transient, not a stale build", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onUpdateRequired = vi.fn();
    const outcome = await recoverFromChunkFailure({
      storage,
      buildId: "b2",
      reload,
      onUpdateRequired,
      // Offline: the deployed build could not be determined.
      confirmBuildMismatch: async () => null,
    });
    expect(outcome).toBe("transient-network");
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateRequired).not.toHaveBeenCalled();
    // No marker is burned, so genuine recovery is still available later.
    expect(storage.dump()).toEqual({});
  });

  it("does not reload when the origin serves the same build", async () => {
    const reload = vi.fn();
    const outcome = await recoverFromChunkFailure({
      storage: memoryStorage(),
      buildId: "b2",
      reload,
      onUpdateRequired: vi.fn(),
      confirmBuildMismatch: async () => false,
    });
    expect(outcome).toBe("transient-network");
    expect(reload).not.toHaveBeenCalled();
  });
});
