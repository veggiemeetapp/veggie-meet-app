/**
 * WO-145H — the post-departure stabilization policy must be deterministic:
 * quiet means activate, change means restart (never consume the activation
 * timeout), protected work means block, and the whole phase stays bounded.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_MS,
  awaitStabilization,
  type StabilizationSample,
} from "@/lib/updateStabilization";

function harness(samples: StabilizationSample[]) {
  let t = 0;
  let i = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    sample: () => samples[Math.min(i++, samples.length - 1)],
    calls: () => i,
  };
}

const quiet: StabilizationSample = {
  clients: 1,
  activity: 10,
  outstanding: 0,
  reappeared: false,
  dirty: false,
};

describe("post-departure stabilization", () => {
  it("activates once the client set and worker activity are quiet", async () => {
    const h = harness([quiet]);
    const r = await awaitStabilization({ ...h });
    expect(r.outcome).toBe("quiet");
    expect(r.restarts).toBe(0);
    expect(r.quietMs).toBeGreaterThanOrEqual(DEFAULT_QUIET_MS);
  });

  it("restarts the quiet interval when worker activity changes", async () => {
    const h = harness([
      quiet,
      { ...quiet, activity: 11 },
      { ...quiet, activity: 12 },
      { ...quiet, activity: 12 },
    ]);
    const r = await awaitStabilization({ ...h });
    expect(r.outcome).toBe("quiet");
    expect(r.restarts).toBe(2);
  });

  it("restarts when the authoritative client set changes", async () => {
    const h = harness([quiet, { ...quiet, clients: 2 }, { ...quiet, clients: 2 }]);
    const r = await awaitStabilization({ ...h });
    expect(r.outcome).toBe("quiet");
    expect(r.restarts).toBe(1);
  });

  it("never activates while the outgoing worker has a pending request", async () => {
    const h = harness([
      { ...quiet, pending: 1 },
      { ...quiet, pending: 1 },
      { ...quiet, pending: 0 },
    ]);
    const r = await awaitStabilization({ ...h });
    expect(r.outcome).toBe("quiet");
    expect(r.restarts).toBeGreaterThanOrEqual(2);
  });

  it("blocks when a remaining client develops unsaved work", async () => {
    const h = harness([quiet, { ...quiet, dirty: true }]);
    const r = await awaitStabilization({ ...h });
    expect(r.outcome).toBe("blocked");
    expect(r.reason).toBe("dirty");
  });

  it("blocks so a reappeared client can give a fresh readiness answer", async () => {
    const h = harness([{ ...quiet, reappeared: true }]);
    const r = await awaitStabilization({ ...h });
    expect(r).toMatchObject({ outcome: "blocked", reason: "reappeared" });
  });

  it("blocks while a discovered client still owes an acknowledgement", async () => {
    const h = harness([{ ...quiet, outstanding: 1 }]);
    const r = await awaitStabilization({ ...h });
    expect(r).toMatchObject({ outcome: "blocked", reason: "outstanding" });
  });

  it("is bounded: endless activity times out instead of hanging", async () => {
    let n = 0;
    let t = 0;
    const r = await awaitStabilization({
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      sample: () => ({ ...quiet, activity: n++ }),
      maxMs: 1_000,
    });
    expect(r.outcome).toBe("timeout");
    expect(r.elapsedMs).toBeLessThanOrEqual(1_100);
  });

  it("tolerates an unavailable worker (null counters still settle)", async () => {
    const h = harness([{ ...quiet, clients: null, activity: null }]);
    const r = await awaitStabilization({ ...h });
    expect(r.outcome).toBe("quiet");
  });

  it("never blocks on a sampling error", async () => {
    let t = 0;
    const r = await awaitStabilization({
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      sample: () => {
        throw new Error("worker gone");
      },
    });
    expect(r.outcome).toBe("quiet");
  });

  it("emits anonymous traces only (no URLs, tokens or content)", async () => {
    const h = harness([quiet]);
    const entries: unknown[] = [];
    await awaitStabilization({ ...h, onTrace: (e) => entries.push(e) });
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toMatch(/http|token|email|@/i);
  });
});
