/**
 * WO-145B — multi-client update coordination proofs.
 *
 * A shared in-memory bus stands in for BroadcastChannel so the tests can assert
 * the protocol (census, deterministic leader, bounded timeouts, exactly-once
 * commit) without a browser.
 */
import { describe, expect, it, vi } from "vitest";
import {
  FleetCoordinator,
  type FleetChannel,
  type FleetMessage,
} from "@/lib/updateFleet";

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
  dirty?: boolean;
  visible?: boolean;
}

function makeClient(bus: ReturnType<typeof createBus>, o: ClientOptions) {
  const commits: { forced: boolean }[] = [];
  const escalations: number[] = [];
  let peerCount = 0;
  const fleet = new FleetCoordinator({
    channel: bus.channelFor(),
    clientId: o.id,
    buildId: "b1",
    isDirty: () => o.dirty === true,
    isVisible: () => o.visible !== false,
    onPeers: (n) => (peerCount = n),
    onCommit: ({ forced }) => commits.push({ forced }),
    onEscalate: () => escalations.push(1),
    censusTimeoutMs: 1,
    commitTimeoutMs: 5,
  });
  fleet.start();
  return {
    fleet,
    commits,
    escalations,
    peers: () => peerCount,
  };
}

describe("FleetCoordinator", () => {
  it("discovers peers on start", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    await new Promise((r) => setTimeout(r, 5));
    expect(a.peers()).toBe(1);
    expect(b.peers()).toBe(1);
    a.fleet.stop();
    b.fleet.stop();
  });

  it("blocks activation while a sibling reports protected work", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b", dirty: true });
    const decision = await a.fleet.requestActivation();
    expect(decision.outcome).toBe("blocked-dirty");
    expect(decision.dirtyPeers).toBe(1);
    a.fleet.stop();
    b.fleet.stop();
  });

  it("forces past a dirty sibling when the member insists", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b", dirty: true });
    const decision = await a.fleet.requestActivation({ force: true });
    expect(decision.outcome).toBe("proceed");
    a.fleet.stop();
    b.fleet.stop();
  });

  it("elects one deterministic leader and commits exactly once per client", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    const [da, db] = await Promise.all([
      a.fleet.requestActivation(),
      b.fleet.requestActivation(),
    ]);
    expect([da.leader, db.leader]).toEqual(["a", "a"]);
    expect(da.outcome).toBe("proceed");
    expect(db.outcome).toBe("deferred");

    a.fleet.commitActivation(false);
    a.fleet.commitActivation(false); // duplicate commit must not double-notify
    await new Promise((r) => setTimeout(r, 2));
    expect(b.commits).toHaveLength(1);
    expect(a.commits).toHaveLength(0); // the leader reloads via its own path
    a.fleet.stop();
    b.fleet.stop();
  });

  it("escalates when the elected leader never commits", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const b = makeClient(bus, { id: "b" });
    const [, db] = await Promise.all([
      a.fleet.requestActivation(),
      b.fleet.requestActivation(),
    ]);
    expect(db.outcome).toBe("deferred");
    a.fleet.stop(); // leader disappears without committing
    await new Promise((r) => setTimeout(r, 20));
    expect(b.escalations).toHaveLength(1);
    b.fleet.stop();
  });

  it("never blocks on a client that has gone away", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const gone = makeClient(bus, { id: "z", dirty: true });
    gone.fleet.stop();
    const decision = await a.fleet.requestActivation();
    expect(decision.outcome).toBe("proceed");
    expect(decision.dirtyPeers).toBe(0);
    a.fleet.stop();
  });

  it("announces a waiting build to siblings", async () => {
    const bus = createBus();
    const a = makeClient(bus, { id: "a" });
    const spy = vi.fn();
    const raw = bus.channelFor();
    raw.subscribe(spy);
    a.fleet.announceAvailable();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "available", from: "a" }),
    );
    a.fleet.stop();
  });
});
