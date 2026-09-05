/**
 * WO-145G — "sibling closed during preparation" boundary proofs.
 *
 * The one unexplained live failure was a transaction that never activated after
 * a sibling window was closed mid-preparation. Cause: the outstanding
 * acknowledgement set was snapshotted when the transaction opened and never
 * recalculated, so a client that closed either burned the whole preparation
 * window or was later mistaken for a frozen, unresponsive blocker.
 *
 * These tests pin the corrected behaviour at every closure boundary: a confirmed
 * departure leaves the outstanding set immediately, a client that is genuinely
 * still there still blocks, and a client that comes back with unsaved work can
 * still veto the update.
 */
import { describe, expect, it } from "vitest";
import {
  FleetCoordinator,
  type FleetChannel,
  type FleetMessage,
  type PrepareAck,
} from "@/lib/updateFleet";

function createBus() {
  const listeners = new Set<(m: FleetMessage) => void>();
  return {
    post: (m: FleetMessage) => listeners.forEach((l) => l(m)),
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

function makeClient(
  bus: ReturnType<typeof createBus>,
  o: { id: string; ack?: PrepareAck; visible?: boolean },
) {
  let ack = o.ack ?? "ready";
  const fleet = new FleetCoordinator({
    channel: bus.channelFor(),
    clientId: o.id,
    buildId: "b1",
    isDirty: () => ack === "blocked",
    isVisible: () => o.visible !== false,
    onCommit: () => {},
    onPrepare: () => ack,
    prepareTimeoutMs: 200,
    prepareLeaseMs: 100,
    censusTimeoutMs: 1,
    commitTimeoutMs: 5,
  });
  fleet.start();
  return {
    fleet,
    setAck: (a: PrepareAck) => {
      ack = a;
    },
  };
}

/** A discovered-but-unresponsive client: on the channel, never acknowledges. */
function makeGhost(bus: ReturnType<typeof createBus>, id: string) {
  bus.post({ type: "hello", from: id, buildId: "b1" });
  return {
    close: () => bus.post({ type: "bye", from: id }),
  };
}

describe("WO-145G close-during-preparation boundaries", () => {
  it("a sibling closed before preparation is never expected at all", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    b.fleet.stop();

    const r = await a.fleet.prepareFleet("t-before");
    expect(r.outcome).toBe("ready");
    expect(r.expected).toEqual([]);
    a.fleet.stop();
  });

  it("a sibling that disappears during discovery resolves ready, not blocked", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const ghost = makeGhost(bus, "ghost-1");

    const pending = a.fleet.prepareFleet("t-discovery");
    ghost.close();
    const r = await pending;

    expect(r.outcome).toBe("ready");
    expect(r.departed).toEqual(["ghost-1"]);
    expect(r.silent).toEqual([]);
    a.fleet.stop();
  });

  it("a sibling that closes before acknowledging ends the wait early", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const ghost = makeGhost(bus, "ghost-2");

    const pending = a.fleet.prepareFleet("t-preack");
    setTimeout(() => ghost.close(), 20);
    const r = await pending;

    expect(r.outcome).toBe("ready");
    // Resolved on the departure, well inside the 200 ms bounded window.
    expect(r.elapsedMs).toBeLessThan(200);
    expect(a.fleet.outstandingFor("t-preack")).toEqual([]);
    a.fleet.stop();
  });

  it("a sibling that closes immediately after acknowledging is not a blocker", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });

    const pending = a.fleet.prepareFleet("t-postack");
    setTimeout(() => b.fleet.stop(), 10);
    const r = await pending;

    expect(r.outcome).toBe("ready");
    expect(r.silent).toEqual([]);
    a.fleet.stop();
  });

  it("a sibling that is genuinely still there and silent still blocks", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    makeGhost(bus, "frozen-1");

    const r = await a.fleet.prepareFleet("t-frozen");
    expect(r.outcome).toBe("blocked-unprepared");
    expect(r.silent).toEqual(["frozen-1"]);
    expect(a.fleet.outstandingFor("t-frozen")).toEqual(["frozen-1"]);
    a.fleet.stop();
  });

  it("a client that closes and comes back with unsaved work still vetoes", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    b.fleet.stop();

    const returning = makeClient(bus, { id: "b", ack: "blocked" });
    const r = await a.fleet.prepareFleet("t-return");
    expect(r.outcome).toBe("blocked-dirty");
    expect(r.dirty).toEqual(["b"]);
    returning.fleet.stop();
    a.fleet.stop();
  });

  it("departure and acknowledgement messages stay idempotent", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const ghost = makeGhost(bus, "ghost-3");

    const pending = a.fleet.prepareFleet("t-idem");
    ghost.close();
    ghost.close();
    bus.post({ type: "bye", from: "ghost-3" });
    const r = await pending;

    expect(r.outcome).toBe("ready");
    expect(r.departed).toEqual(["ghost-3"]);
    a.fleet.stop();
  });

  it("traces the transaction with anonymous, timestamped events", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    await a.fleet.prepareFleet("t-trace");
    a.fleet.commitActivation(false, "t-trace");

    const events = a.fleet.traceEvents();
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("prepare-sent");
    expect(kinds).toContain("ack");
    expect(kinds).toContain("commit");
    expect(events.every((e) => typeof e.t === "number" && e.t > 0)).toBe(true);
    // Diagnostics carry counts and anonymous ids only.
    expect(JSON.stringify(events)).not.toMatch(/http|token|email|@/i);
    b.fleet.stop();
    a.fleet.stop();
  });
});
