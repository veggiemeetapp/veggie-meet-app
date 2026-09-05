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

export type PrepareAck = "ready" | "blocked" | "unable";

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
  /** WO-145F — fleet-wide update-preparation request for one transaction. */
  | { type: "prepare"; from: string; txnId: string }
  | {
      type: "prepare-ack";
      from: string;
      txnId: string;
      ack: PrepareAck;
      visible: boolean;
    }
  /** WO-145F — the transaction was abandoned: restore normal behaviour. */
  | { type: "prepare-cancel"; from: string; txnId: string }
  | { type: "commit"; from: string; forced: boolean; txnId?: string };


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
  /**
   * WO-145F — this client was asked to prepare for update transaction `txnId`.
   * It must enter the bounded quiescent state and return its acknowledgement:
   * `ready`, `blocked` (unsaved work / active mutation) or `unable`.
   * Called at most once per transaction; repeated requests re-use the answer.
   */
  onPrepare?: (txnId: string) => PrepareAck;
  /** WO-145F — the transaction ended without committing: restore normal work. */
  onPrepareCancel?: (txnId: string) => void;
  /** WO-145G — anonymous, timestamped transaction trace for diagnostics. */
  onTrace?: (event: FleetTraceEvent) => void;

  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  censusTimeoutMs?: number;
  commitTimeoutMs?: number;
  /** How long responsive clients are given to acknowledge a preparation. */
  prepareTimeoutMs?: number;
  /** How long a prepared client stays quiesced without a commit. */
  prepareLeaseMs?: number;
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

/** WO-145G — one anonymous, timestamped step of an update transaction. */
export interface FleetTraceEvent {
  t: number;
  txnId: string;
  event:
    | "prepare-sent"
    | "ack"
    | "departed"
    | "resolved-complete"
    | "resolved-timeout"
    | "recheck"
    | "cancelled"
    | "commit";
  /** Anonymous client id (random per client; never personal data). */
  client?: string;
  detail?: Record<string, string | number | boolean>;
}

/** WO-145F — result of the fleet-wide preparation phase for one transaction. */
export interface PrepareResult {
  txnId: string;
  /**
   *  - `ready`: every discovered responsive client is quiescent — SKIP_WAITING
   *    may be sent exactly once for this transaction;
   *  - `blocked-dirty`: a sibling holds unsaved work or an active mutation;
   *  - `blocked-unprepared`: a sibling answered `unable`, or was discovered but
   *    never acknowledged within the bounded window (frozen/unresponsive).
   */
  outcome: "ready" | "blocked-dirty" | "blocked-unprepared";
  /** Clients that acknowledged, by acknowledgement. */
  ready: string[];
  dirty: string[];
  unable: string[];
  /** Clients seen on the channel that never acknowledged in the window. */
  silent: string[];
  /**
   * WO-145G — clients that were discovered when the transaction opened but are
   * confirmed gone (they said goodbye, or left the peer set). They are removed
   * from the outstanding acknowledgement set and are never blockers.
   */
  departed: string[];
  /** Clients discovered when the transaction opened. */
  expected: string[];
  /** True when at least one blocking client reported itself visible. */
  blockerVisible: boolean;
  /** Milliseconds spent in the preparation window. */
  elapsedMs: number;
}


const DEFAULT_CENSUS_TIMEOUT_MS = 1_200;
const DEFAULT_COMMIT_TIMEOUT_MS = 6_000;
/**
 * WO-145F: the preparation window is short by design. An unresponsive client can
 * only delay the member by this much; after it elapses the real client set is
 * rechecked through the service worker and the member gets specific guidance
 * instead of an indefinite spinner.
 */
const DEFAULT_PREPARE_TIMEOUT_MS = 1_500;
/** How long a prepared (quiesced) client waits for a commit before restoring. */
const DEFAULT_PREPARE_LEASE_MS = 30_000;


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

  /* ---------- WO-145F preparation state ---------- */
  /** Acknowledgements observed for the transaction this client is leading. */
  private prepareAcks = new Map<string, { ack: PrepareAck; visible: boolean }>();
  /** Transaction this client is leading (null when it is not the accepting one). */
  private leadingTxn: string | null = null;
  /** Transaction this client is prepared FOR, with its own answer (idempotency). */
  private preparedTxn: string | null = null;
  private preparedAck: PrepareAck | null = null;
  private prepareLeaseTimer: unknown = null;
  /** Commits already applied, so duplicate commit messages are inert. */
  private appliedCommits = new Set<string>();
  /** WO-145G — clients confirmed gone (said goodbye or removed from the set). */
  private departed = new Set<string>();
  /** WO-145G — clients discovered when the current transaction opened. */
  private expectedForTxn = new Set<string>();
  private traceLog: FleetTraceEvent[] = [];



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
    this.clearPrepareLease();
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
    // WO-145G — a client that comes back is re-admitted, so a reappearing
    // window with unsaved work can still veto the transaction.
    this.departed.delete(id);
    if (!this.peers.has(id)) {
      this.peers.add(id);
      this.deps.onPeers?.(this.peers.size);
    }
  }

  /** WO-145G — record one anonymous, timestamped transaction step. */
  private trace(
    txnId: string,
    event: FleetTraceEvent["event"],
    client?: string,
    detail?: Record<string, string | number | boolean>,
  ): void {
    const entry: FleetTraceEvent = { t: Date.now(), txnId, event, client, detail };
    this.traceLog.push(entry);
    if (this.traceLog.length > 200) this.traceLog.shift();
    try {
      this.deps.onTrace?.(entry);
    } catch {
      /* diagnostics must never break the protocol */
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
        // WO-145G — a confirmed departure is authoritative for the lifetime of
        // the transaction: it is removed from the outstanding acknowledgement
        // set instead of being mistaken for a frozen window. A client that
        // reappears says "hello" again and is re-admitted by `notePeer`, and it
        // will report `blocked` if it holds unsaved work.
        this.departed.add(m.from);
        if (this.leadingTxn) this.trace(this.leadingTxn, "departed", m.from);
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
      // WO-145F — a sibling asked this client to prepare for a transaction.
      case "prepare": {
        this.notePeer(m.from);
        const ack = this.answerPrepare(m.txnId);
        this.deps.channel.post({
          type: "prepare-ack",
          from: this.deps.clientId,
          txnId: m.txnId,
          ack,
          visible: this.deps.isVisible(),
        });
        break;
      }
      case "prepare-ack":
        this.notePeer(m.from);
        // Duplicate acknowledgements collapse: the map is keyed by client id.
        if (m.txnId === this.leadingTxn) {
          this.prepareAcks.set(m.from, { ack: m.ack, visible: m.visible });
          this.trace(m.txnId, "ack", m.from, { ack: m.ack, visible: m.visible });
        }
        break;
      case "prepare-cancel":
        this.notePeer(m.from);
        this.releasePrepare(m.txnId);
        break;

      case "commit": {
        this.notePeer(m.from);
        const key = m.txnId ?? `legacy:${m.from}`;
        if (this.appliedCommits.has(key)) return; // idempotent per transaction
        this.appliedCommits.add(key);
        if (this.committed) return; // exactly-once convergence per client
        this.committed = true;
        this.clearPrepareLease();
        if (this.commitTimer !== null) {
          this.clearTimer(this.commitTimer);
          this.commitTimer = null;
        }
        this.deps.onCommit({ forced: m.forced, from: m.from });
        break;
      }
    }
  }

  /* ---------- WO-145F preparation protocol ---------- */

  private clearPrepareLease(): void {
    if (this.prepareLeaseTimer !== null) {
      this.clearTimer(this.prepareLeaseTimer);
      this.prepareLeaseTimer = null;
    }
  }

  /**
   * Enter (or re-report) the quiescent state for `txnId`. Idempotent: a repeated
   * `prepare` for the same transaction returns the same answer and never
   * quiesces twice, so duplicate broadcasts cannot cause extra work or reloads.
   */
  private answerPrepare(txnId: string): PrepareAck {
    if (this.preparedTxn === txnId && this.preparedAck !== null)
      return this.preparedAck;

    // A different transaction supersedes an earlier one: release the old lease
    // so the client can never be left quiesced for an abandoned transaction.
    if (this.preparedTxn !== null && this.preparedTxn !== txnId)
      this.releasePrepare(this.preparedTxn);

    let ack: PrepareAck;
    try {
      ack = this.deps.onPrepare?.(txnId) ?? (this.deps.isDirty() ? "blocked" : "ready");
    } catch {
      ack = "unable";
    }
    this.preparedTxn = txnId;
    this.preparedAck = ack;

    if (ack === "ready") {
      // Bounded lease: if the accepting client vanishes without committing or
      // cancelling, this client restores itself instead of staying paused.
      this.clearPrepareLease();
      this.prepareLeaseTimer = this.setTimer(() => {
        this.prepareLeaseTimer = null;
        this.releasePrepare(txnId);
      }, this.deps.prepareLeaseMs ?? DEFAULT_PREPARE_LEASE_MS);
    }
    return ack;
  }

  /** Restore normal behaviour after a cancelled/expired preparation. */
  private releasePrepare(txnId: string): void {
    if (this.preparedTxn !== txnId) return;
    this.preparedTxn = null;
    this.preparedAck = null;
    this.clearPrepareLease();
    try {
      this.deps.onPrepareCancel?.(txnId);
    } catch {
      /* a broken restore must never break the channel */
    }
  }

  /**
   * Accepting client: ask every same-origin VeggieMeet client to quiesce for
   * `txnId` and resolve once they have all answered — or once the bounded
   * preparation window elapses, whichever comes first.
   *
   * WO-145G — a client that closes mid-preparation is deterministic, not a
   * blocker. The outstanding acknowledgement set is recomputed on every tick
   * from `peers` minus `departed`, so the transaction resolves the instant the
   * last *existing* client is ready instead of burning the whole window (and,
   * worse, then treating the gone client as an unresponsive blocker).
   */
  async prepareFleet(txnId: string, options: { force?: boolean } = {}): Promise<PrepareResult> {
    this.leadingTxn = txnId;
    this.prepareAcks.clear();
    const expected = new Set(this.peers);
    this.expectedForTxn = expected;
    for (const id of this.departed) expected.delete(id);

    this.deps.channel.post({ type: "prepare", from: this.deps.clientId, txnId });
    this.trace(txnId, "prepare-sent", undefined, { expected: expected.size });

    const timeout = this.deps.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
    const started = Date.now();
    let timedOut = false;
    await new Promise<void>((resolve) => {
      const tick = () => {
        // Recomputed every tick: departures shrink the set, so the wait ends.
        const outstanding = this.outstandingFor(txnId);
        if (outstanding.length === 0) {
          resolve();
          return;
        }
        if (Date.now() - started >= timeout) {
          timedOut = true;
          resolve();
          return;
        }
        this.setTimer(tick, Math.min(50, timeout));
      };
      this.setTimer(tick, 0);
    });

    const ready: string[] = [];
    const dirty: string[] = [];
    const unable: string[] = [];
    let blockerVisible = false;
    for (const [id, entry] of this.prepareAcks) {
      // An acknowledgement from a client that has since closed cannot block:
      // it no longer exists, so it holds no work and runs no requests.
      if (this.departed.has(id)) continue;
      if (entry.ack === "ready") ready.push(id);
      else if (entry.ack === "blocked") {
        dirty.push(id);
        blockerVisible = blockerVisible || entry.visible;
      } else {
        unable.push(id);
        blockerVisible = blockerVisible || entry.visible;
      }
    }
    // A client that STILL EXISTS on the channel but never answered is treated as
    // unresponsive. A confirmed-closed client is excluded (WO-145G).
    const silent = this.outstandingFor(txnId);
    const departed = [...expected].filter((id) => this.departed.has(id));

    let outcome: PrepareResult["outcome"] = "ready";
    if (dirty.length > 0 && !options.force) outcome = "blocked-dirty";
    else if (unable.length > 0 || silent.length > 0) outcome = "blocked-unprepared";

    const elapsedMs = Date.now() - started;
    this.trace(txnId, timedOut ? "resolved-timeout" : "resolved-complete", undefined, {
      outcome,
      ready: ready.length,
      dirty: dirty.length,
      unable: unable.length,
      silent: silent.length,
      departed: departed.length,
      elapsedMs,
    });

    return {
      txnId,
      outcome,
      ready,
      dirty,
      unable,
      silent,
      departed,
      expected: [...expected],
      blockerVisible,
      elapsedMs,
    };
  }

  /**
   * WO-145G — the authoritative outstanding acknowledgement set for `txnId`:
   * discovered clients that still exist on the channel, are not confirmed
   * closed, and have not acknowledged. Callers use it to re-check a blocked
   * outcome before blaming a window that has since been closed.
   */
  outstandingFor(txnId: string): string[] {
    if (this.leadingTxn !== txnId) return [];
    return [...this.expectedForTxn].filter(
      (id) => !this.prepareAcks.has(id) && this.peers.has(id) && !this.departed.has(id),
    );
  }

  /** WO-145G — anonymous transaction trace collected in this client. */
  traceEvents(): FleetTraceEvent[] {
    return [...this.traceLog];
  }


  /** Abandon a transaction: every prepared client restores normal behaviour. */
  cancelPreparation(txnId: string): void {
    if (this.leadingTxn === txnId) this.leadingTxn = null;
    this.prepareAcks.clear();
    this.deps.channel.post({
      type: "prepare-cancel",
      from: this.deps.clientId,
      txnId,
    });
    this.releasePrepare(txnId);
    this.trace(txnId, "cancelled");
    this.expectedForTxn = new Set();
  }

  /** Test/inspection helper: is this client currently quiesced for a txn? */
  preparedFor(): string | null {
    return this.preparedTxn;
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
  commitActivation(forced: boolean, txnId?: string): void {
    const key = txnId ?? `legacy:${this.deps.clientId}`;
    if (this.appliedCommits.has(key)) return; // one commit per transaction
    this.appliedCommits.add(key);
    this.committed = true;
    this.deps.channel.post({
      type: "commit",
      from: this.deps.clientId,
      forced,
      txnId,
    });
    this.trace(key, "commit", undefined, { forced });
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
