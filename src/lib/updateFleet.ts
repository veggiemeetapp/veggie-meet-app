/**
 * WO-145B — multi-client update coordination ("the fleet").
 *
 * The problem WO-145 left open
 * ---------------------------
 * WO-145 made *this* client's update deterministic, but the generated worker
 * still shipped `clientsClaim: true`. A worker that activates because tab A
 * asked for it then immediately claims tab B — tab B keeps executing build N
 * JavaScript while its subsequent requests (lazy chunks, HTML, assets) are
 * served by the build N+1 worker. That is exactly the mixed-build state the
 * closeout claimed could not happen.
 *
 * WO-145B closes it with two changes that must be read together:
 *
 *  1. `clientsClaim: false` in the Workbox config (see vite.config.ts). A newly
 *     activated worker never takes over an existing document. Old documents keep
 *     their old worker until they reload, so an old document is always paired
 *     with its own build's worker.
 *  2. This module. Before any activation, the requesting client takes a census
 *     of every live same-origin VeggieMeet client (ordinary tabs and installed
 *     PWA windows share one BroadcastChannel). Activation proceeds only when no
 *     responsive client reports protected unsaved work, and every client is then
 *     told to converge — each reloading at most once.
 *
 * Policy (single, documented, applies to every client)
 * ---------------------------------------------------
 *  - Availability is announced fleet-wide; every client may prompt, but only one
 *    activation ever runs (deterministic leader = lexicographically smallest
 *    client id among the intents observed in the census window).
 *  - A responsive client reporting dirty work vetoes activation. The member can
 *    override with an explicitly warned forced update, which is broadcast as
 *    forced so sibling clients know their draft is being discarded by choice.
 *  - After the commit, every non-leader client enters `update-required` and
 *    reloads exactly once when it is safe (clean, or forced).
 *  - A client that is dirty at commit time does not reload; it stays on its own
 *    (old) worker — never mixed — and is blocked from version-sensitive
 *    operations until the member saves or discards.
 *  - Every wait is bounded: an unreachable, crashed or frozen client can only
 *    delay convergence by `censusTimeoutMs`, never deadlock it.
 *
 * The module is transport-agnostic and clock-injected so the whole protocol is
 * unit-testable with an in-memory bus and no browser.
 */

export type FleetMessage =
  | { type: "hello"; from: string; buildId: string }
  | { type: "here"; from: string; buildId: string }
  | { type: "bye"; from: string }
  | { type: "available"; from: string; buildId: string }
  | { type: "census"; from: string; round: number }
  | {
      type: "census-reply";
      from: string;
      round: number;
      buildId: string;
      visible: boolean;
      dirty: boolean;
    }
  | { type: "intent"; from: string; round: number }
  | { type: "commit"; from: string; forced: boolean };

export interface FleetChannel {
  post: (message: FleetMessage) => void;
  subscribe: (listener: (message: FleetMessage) => void) => () => void;
  close?: () => void;
}

export interface FleetDeps {
  channel: FleetChannel;
  clientId: string;
  buildId: string;
  /** This client's protected-work state at the moment of the call. */
  isDirty: () => boolean;
  isVisible: () => boolean;
  /** Another client committed an activation: converge (reload once, if safe). */
  onCommit: (info: { forced: boolean; from: string }) => void;
  /** Peer census changed (used only for copy such as "close other windows"). */
  onPeers?: (peerCount: number) => void;
  /** A deferred activation never got its commit — take over as leader. */
  onEscalate?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  censusTimeoutMs?: number;
  commitTimeoutMs?: number;
}

export interface CensusPeer {
  clientId: string;
  buildId: string;
  visible: boolean;
  dirty: boolean;
}

export interface ActivationDecision {
  outcome: "proceed" | "blocked-dirty" | "deferred";
  /** Peers that answered the census (excludes this client). */
  peers: CensusPeer[];
  /** Peers that reported protected unsaved work. */
  dirtyPeers: number;
  /** Elected leader for this round. */
  leader: string;
}

const DEFAULT_CENSUS_TIMEOUT_MS = 1_200;
const DEFAULT_COMMIT_TIMEOUT_MS = 6_000;

export function randomClientId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
      return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `c-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export class FleetCoordinator {
  private deps: FleetDeps;
  private unsubscribe: (() => void) | null = null;
  private round = 0;
  private replies = new Map<string, CensusPeer>();
  private intents = new Set<string>();
  private peers = new Set<string>();
  private committed = false;
  /** True while a census window for `round` is open (locally or adopted). */
  private roundActive = false;
  private commitTimer: unknown = null;
  private stopped = false;

  constructor(deps: FleetDeps) {
    this.deps = deps;
  }

  private get setTimer() {
    return this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  }
  private get clearTimer() {
    return (
      this.deps.clearTimer ??
      ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    );
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.channel.subscribe((m) => this.onMessage(m));
    this.deps.channel.post({
      type: "hello",
      from: this.deps.clientId,
      buildId: this.deps.buildId,
    });
  }

  stop(): void {
    this.stopped = true;
    try {
      this.deps.channel.post({ type: "bye", from: this.deps.clientId });
    } catch {
      /* channel already closed */
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.commitTimer !== null) {
      this.clearTimer(this.commitTimer);
      this.commitTimer = null;
    }
    this.deps.channel.close?.();
  }

  peerCount(): number {
    return this.peers.size;
  }

  /** Tell every client a new build is waiting, so prompts are not tab-local. */
  announceAvailable(): void {
    this.deps.channel.post({
      type: "available",
      from: this.deps.clientId,
      buildId: this.deps.buildId,
    });
  }

  private notePeer(id: string): void {
    if (id === this.deps.clientId) return;
    if (!this.peers.has(id)) {
      this.peers.add(id);
      this.deps.onPeers?.(this.peers.size);
    }
  }

  private adoptRound(round: number): void {
    if (round <= this.round) return;
    this.round = round;
    this.roundActive = true;
    this.replies.clear();
    this.intents.clear();
    this.intents.add(this.deps.clientId);
  }

  private onMessage(m: FleetMessage): void {
    if (this.stopped) return;
    if ("from" in m && m.from === this.deps.clientId) return;

    switch (m.type) {
      case "hello":
        this.notePeer(m.from);
        this.deps.channel.post({
          type: "here",
          from: this.deps.clientId,
          buildId: this.deps.buildId,
        });
        break;
      case "here":
      case "available":
        this.notePeer(m.from);
        break;
      case "bye":
        if (this.peers.delete(m.from)) this.deps.onPeers?.(this.peers.size);
        this.replies.delete(m.from);
        this.intents.delete(m.from);
        break;
      case "census":
        this.notePeer(m.from);
        // Two clients can start a round at almost the same instant. Adopting a
        // higher round makes every participant converge on ONE round, so the
        // leader election below is deterministic instead of split-brained.
        this.adoptRound(m.round);
        this.deps.channel.post({
          type: "census-reply",
          from: this.deps.clientId,
          round: m.round,
          buildId: this.deps.buildId,
          visible: this.deps.isVisible(),
          dirty: this.deps.isDirty(),
        });
        break;
      case "census-reply":
        this.notePeer(m.from);
        if (m.round === this.round)
          this.replies.set(m.from, {
            clientId: m.from,
            buildId: m.buildId,
            visible: m.visible,
            dirty: m.dirty,
          });
        break;
      case "intent":
        this.notePeer(m.from);
        this.adoptRound(m.round);
        if (m.round === this.round) this.intents.add(m.from);
        break;
      case "commit":
        this.notePeer(m.from);
        if (this.committed) return; // exactly-once convergence per client
        this.committed = true;
        if (this.commitTimer !== null) {
          this.clearTimer(this.commitTimer);
          this.commitTimer = null;
        }
        this.deps.onCommit({ forced: m.forced, from: m.from });
        break;
    }
  }

  /**
   * Census + leader election. Resolves after a bounded window, so a crashed or
   * frozen sibling can never block the member's update.
   */
  async requestActivation(options: { force?: boolean } = {}): Promise<ActivationDecision> {
    // Join an in-flight round rather than starting a competing one, so peers
    // that pressed "Update now" simultaneously elect the same leader.
    if (!this.roundActive) {
      this.round += 1;
      this.replies.clear();
      this.intents.clear();
      this.roundActive = true;
    }
    this.intents.add(this.deps.clientId);
    const round = this.round;

    this.deps.channel.post({ type: "census", from: this.deps.clientId, round });
    this.deps.channel.post({ type: "intent", from: this.deps.clientId, round });

    await new Promise<void>((resolve) =>
      this.setTimer(resolve, this.deps.censusTimeoutMs ?? DEFAULT_CENSUS_TIMEOUT_MS),
    );

    this.roundActive = false;
    const peers = [...this.replies.values()];
    const dirtyPeers = peers.filter((p) => p.dirty).length;
    const leader = [...this.intents].sort()[0];

    if (dirtyPeers > 0 && !options.force)
      return { outcome: "blocked-dirty", peers, dirtyPeers, leader };

    if (leader !== this.deps.clientId) {
      // Someone else is the deterministic leader. Wait for their commit, but
      // never forever: if it never arrives, take over.
      this.commitTimer = this.setTimer(() => {
        this.commitTimer = null;
        if (!this.committed) this.deps.onEscalate?.();
      }, this.deps.commitTimeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS);
      return { outcome: "deferred", peers, dirtyPeers, leader };
    }

    return { outcome: "proceed", peers, dirtyPeers, leader };
  }

  /** Leader only: tell the fleet the new build is taking over. */
  commitActivation(forced: boolean): void {
    this.committed = true;
    this.deps.channel.post({
      type: "commit",
      from: this.deps.clientId,
      forced,
    });
  }
}

/** BroadcastChannel adapter. Returns null where the API is unavailable. */
export function createBroadcastFleetChannel(name: string): FleetChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const bc = new BroadcastChannel(name);
  const listeners = new Set<(m: FleetMessage) => void>();
  bc.onmessage = (event: MessageEvent) => {
    const data = event.data as FleetMessage | null;
    if (!data || typeof data.type !== "string") return;
    listeners.forEach((l) => l(data));
  };
  return {
    post: (message) => {
      try {
        bc.postMessage(message);
      } catch {
        /* channel closing during unload */
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      listeners.clear();
      try {
        bc.close();
      } catch {
        /* already closed */
      }
    },
  };
}
