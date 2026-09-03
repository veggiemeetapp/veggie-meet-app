/**
 * WO-145F — fleet-wide update-preparation proofs.
 *
 * The in-memory bus stands in for BroadcastChannel so the whole protocol
 * (transaction identity, bounded preparation, ready/blocked/unable
 * acknowledgements, idempotency, cancellation and restore) is provable without a
 * browser. The real production builds are exercised separately in the WO-145F
 * multi-client browser matrix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FleetCoordinator,
  type FleetChannel,
  type FleetMessage,
  type PrepareAck,
} from "@/lib/updateFleet";
import {
  beginQuiesce,
  endQuiesce,
  isQuiesced,
  quiescedTransaction,
  registerAbortableRequest,
  resetQuiesceState,
} from "@/lib/updateQuiesce";
import { isAnalyticsDeliveryPaused } from "@/lib/analytics";

function createBus() {
  const listeners = new Set<(m: FleetMessage) => void>();
  return {
    channelFor(): FleetChannel {
      const own = new Set<(m: FleetMessage) => void>();
      return {
        post: (m) => listeners.forEach((l) => l(m)),
        subscribe: (l) => {
          listeners.add(l);
          own.add(l);
          return () => {
            listeners.delete(l);
            own.delete(l);
          };
        },
        close: () => own.forEach((l) => listeners.delete(l)),
      };
    },
  };
}

interface ClientOptions {
  id: string;
  ack?: PrepareAck;
  visible?: boolean;
  silent?: boolean;
}

function makeClient(bus: ReturnType<typeof createBus>, o: ClientOptions) {
  const prepared: string[] = [];
  const cancelled: string[] = [];
  const commits: { forced: boolean }[] = [];
  const fleet = new FleetCoordinator({
    channel: bus.channelFor(),
    clientId: o.id,
    buildId: "b1",
    isDirty: () => o.ack === "blocked",
    isVisible: () => o.visible !== false,
    onCommit: ({ forced }) => commits.push({ forced }),
    onPrepare: (txnId) => {
      if (o.silent) throw new Error("frozen"); // never answers usefully
      prepared.push(txnId);
      return o.ack ?? "ready";
    },
    onPrepareCancel: (txnId) => cancelled.push(txnId),
    prepareTimeoutMs: 60,
    prepareLeaseMs: 40,
    censusTimeoutMs: 1,
    commitTimeoutMs: 5,
  });
  fleet.start();
  return { fleet, prepared, cancelled, commits };
}

describe("fleet update preparation (WO-145F)", () => {
  beforeEach(() => resetQuiesceState());

  it("prepares a lone client with no siblings and reports ready", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const result = await a.fleet.prepareFleet("t1");
    expect(result.outcome).toBe("ready");
    expect(result.ready).toEqual([]);
    a.fleet.stop();
  });

  it("requires every discovered sibling to acknowledge ready", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    const c = makeClient(bus, { id: "c" });
    const result = await a.fleet.prepareFleet("t2");
    expect(result.outcome).toBe("ready");
    expect(result.ready.sort()).toEqual(["b", "c"]);
    expect(b.prepared).toEqual(["t2"]);
    expect(c.prepared).toEqual(["t2"]);
    a.fleet.stop();
    b.fleet.stop();
    c.fleet.stop();
  });

  it("blocks on a sibling holding unsaved work and never reloads it", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b", ack: "blocked" });
    const result = await a.fleet.prepareFleet("t3");
    expect(result.outcome).toBe("blocked-dirty");
    expect(result.dirty).toEqual(["b"]);
    expect(b.commits).toHaveLength(0);
    a.fleet.stop();
    b.fleet.stop();
  });

  it("reports an unable sibling separately from an unsaved-work sibling", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b", ack: "unable" });
    const result = await a.fleet.prepareFleet("t4");
    expect(result.outcome).toBe("blocked-unprepared");
    expect(result.unable).toEqual(["b"]);
    expect(result.blockerVisible).toBe(true);
    a.fleet.stop();
    b.fleet.stop();
  });

  it("treats a frozen sibling as unprepared within a bounded window", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const frozen = makeClient(bus, { id: "z", silent: true });
    const started = Date.now();
    const result = await a.fleet.prepareFleet("t5");
    // `unable` here is the frozen client's throwing predicate; either way it is
    // never counted as ready and the wait stays bounded.
    expect(result.outcome).toBe("blocked-unprepared");
    expect(Date.now() - started).toBeLessThan(1_000);
    a.fleet.stop();
    frozen.fleet.stop();
  });

  it("does not block on a sibling that closed during preparation", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const gone = makeClient(bus, { id: "z", ack: "blocked" });
    gone.fleet.stop();
    const result = await a.fleet.prepareFleet("t6");
    expect(result.outcome).toBe("ready");
    a.fleet.stop();
  });

  it("is idempotent: duplicate prepares do not re-quiesce or re-answer", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    await a.fleet.prepareFleet("t7");
    await a.fleet.prepareFleet("t7");
    expect(b.prepared).toEqual(["t7"]);
    a.fleet.stop();
    b.fleet.stop();
  });

  it("commits exactly once per transaction despite duplicate commits", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    await a.fleet.prepareFleet("t8");
    a.fleet.commitActivation(false, "t8");
    a.fleet.commitActivation(false, "t8");
    await new Promise((r) => setTimeout(r, 5));
    expect(b.commits).toHaveLength(1);
    a.fleet.stop();
    b.fleet.stop();
  });

  it("cancelling a transaction restores every prepared sibling", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    await a.fleet.prepareFleet("t9");
    expect(b.fleet.preparedFor()).toBe("t9");
    a.fleet.cancelPreparation("t9");
    expect(b.cancelled).toEqual(["t9"]);
    expect(b.fleet.preparedFor()).toBeNull();
    a.fleet.stop();
    b.fleet.stop();
  });

  it("a prepared sibling restores itself if no commit ever arrives", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    await a.fleet.prepareFleet("t10");
    await new Promise((r) => setTimeout(r, 80));
    expect(b.cancelled).toEqual(["t10"]);
    a.fleet.stop();
    b.fleet.stop();
  });
});

describe("quiescence (WO-145F)", () => {
  beforeEach(() => resetQuiesceState());

  it("pauses analytics, cancels queries and aborts abortable requests", () => {
    const cancelQueries = vi.fn();
    const controller = new AbortController();
    registerAbortableRequest(controller);
    const report = beginQuiesce("t1", {
      queryClient: {
        cancelQueries,
        isMutating: () => 0,
        getQueryCache: () => ({ getAll: () => [{ state: { fetchStatus: "fetching" } }] }),
      } as never,
      realtimeClient: null,
    });
    expect(cancelQueries).toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(true);
    expect(report.queriesCancelled).toBe(1);
    expect(report.requestsAborted).toBe(1);
    expect(isQuiesced()).toBe(true);
    expect(quiescedTransaction()).toBe("t1");
    expect(isAnalyticsDeliveryPaused()).toBe(true);
  });

  it("is idempotent per transaction", () => {
    const cancelQueries = vi.fn();
    const deps = {
      queryClient: {
        cancelQueries,
        isMutating: () => 0,
        getQueryCache: () => ({ getAll: () => [] }),
      } as never,
      realtimeClient: null,
    };
    beginQuiesce("t2", deps);
    beginQuiesce("t2", deps);
    expect(cancelQueries).toHaveBeenCalledTimes(1);
  });

  it("restores normal behaviour after a cancelled transaction", () => {
    beginQuiesce("t3", { realtimeClient: null });
    expect(endQuiesce("t3")).toBe("restored");
    expect(isQuiesced()).toBe(false);
    expect(isAnalyticsDeliveryPaused()).toBe(false);
  });

  it("ignores a restore for a different transaction", () => {
    beginQuiesce("t4", { realtimeClient: null });
    expect(endQuiesce("other")).toBe("noop");
    expect(isQuiesced()).toBe(true);
  });
});
