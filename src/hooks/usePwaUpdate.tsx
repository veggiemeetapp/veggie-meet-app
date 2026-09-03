/**
 * WO-145 / WO-145B — React binding for the update coordinator and the fleet.
 *
 * Owns exactly four things:
 *  - construct one coordinator per client and attach the real registration;
 *  - run the required update checks (launch / foreground / focus / reconnect /
 *    interval / manual);
 *  - drive the WO-145B multi-client protocol (census, deterministic leader,
 *    bounded timeouts, one commit, one reload per client);
 *  - reconcile authenticated cache freshness on build change, on account change
 *    and on every foreground resume.
 *
 * Everything decision-shaped lives in `src/lib/pwaUpdate.ts`,
 * `src/lib/updateFleet.ts`, `src/lib/buildFreshness.ts` and
 * `src/lib/chunkRecovery.ts` so it stays testable without a DOM service worker.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  UpdateCoordinator,
  startUpdateWatchers,
  type ContainerLike,
  type RegistrationLike,
  type UpdateState,
} from "@/lib/pwaUpdate";
import {
  FleetCoordinator,
  createBroadcastFleetChannel,
  randomClientId,
} from "@/lib/updateFleet";
import { startChunkRecovery } from "@/lib/chunkRecovery";


import {
  LOADED_BUILD_ID,
  fetchDeployedBuildId,
  invalidateCriticalQueries,
  isBuildMismatch,
  reconcileBuildMarkers,
  refreshSessionCriticalQueries,
} from "@/lib/buildFreshness";
import { hasUnsavedWork, unsavedWorkKinds, type UnsavedWorkKind } from "@/lib/unsavedWork";
import {
  beginQuiesce,
  endQuiesce,
  isQuiesced,
  quiesceBackendConnections,
} from "@/lib/updateQuiesce";
import { requestClientCensus } from "@/lib/swClientCensus";






const IDLE_STATE: UpdateState = {
  status: "idle",
  waitingToken: null,
  dismissedToken: null,
  checking: false,
  blockedByUnsavedWork: false,
  otherClientsLikely: false,
  updateRequired: false,
  peerCount: 0,
  lastCheckAt: null,
};

/** WO-145F — which specific sibling condition is blocking the update. */
export type PeerBlocker = "unsaved" | "unprepared" | null;

interface PwaUpdateCtx {
  state: UpdateState;
  /** True when the accessible update prompt should render. */
  visible: boolean;
  buildId: string;
  supported: boolean;
  unsavedKinds: UnsavedWorkKind[];
  /** WO-145B: a fleet census is running (other clients are being polled). */
  coordinating: boolean;
  /** WO-145B: sibling clients reported protected unsaved work. */
  blockedByPeers: number;
  /** WO-145F: the identified blocking condition in another window. */
  peerBlocker: PeerBlocker;
  checkNow: () => Promise<void>;
  updateNow: (options?: { force?: boolean }) => void;
  later: () => void;
  retry: () => void;
  notePromptShown: () => void;
}

const Ctx = createContext<PwaUpdateCtx>({
  state: IDLE_STATE,
  visible: false,
  buildId: LOADED_BUILD_ID,
  supported: false,
  unsavedKinds: [],
  coordinating: false,
  blockedByPeers: 0,
  peerBlocker: null,
  checkNow: async () => {},
  updateNow: () => {},
  later: () => {},
  retry: () => {},
  notePromptShown: () => {},
});

const CHANNEL_NAME = "veggiemeet-update";

export function PwaUpdateProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);
  const [unsavedKinds, setUnsavedKinds] = useState<UnsavedWorkKind[]>([]);
  const [coordinating, setCoordinating] = useState(false);
  const [blockedByPeers, setBlockedByPeers] = useState(0);
  const [peerBlocker, setPeerBlocker] = useState<PeerBlocker>(null);
  /** Open update transaction, so repeated clicks cannot start a second one. */
  const txnRef = useRef<string | null>(null);

  // A single coordinator for the lifetime of the client.
  const coordinatorRef = useRef<UpdateCoordinator | null>(null);
  const fleetRef = useRef<FleetCoordinator | null>(null);
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;

  if (supported && !coordinatorRef.current) {
    coordinatorRef.current = new UpdateCoordinator({
      container: navigator.serviceWorker as unknown as ContainerLike,
      reload: () => window.location.reload(),
      now: () => Date.now(),
      log: (event, properties) => logAnalyticsEvent(event, properties),
      // Active mutations count as work in progress: a reload mid-write would
      // leave the member unsure whether their action landed.
      hasUnsavedWork: () => hasUnsavedWork() || qc.isMutating() > 0,
      // WO-145F: no scheduled/opportunistic check may start while this client is
      // quiesced for a transaction.
      isPaused: () => isQuiesced(),
      // WO-145F: siblings converge only once the new build is genuinely active.
      onActivated: () => {
        const txnId = txnRef.current;
        fleetRef.current?.commitActivation(false, txnId ?? undefined);
      },
      // WO-145E: there is deliberately no registration-release fallback and no
      // migration bridge here. Release N ships directly; a client controlled by
      // the previously published worker keeps that worker until every client of
      // the registration is closed, and then activates Release N normally.
      // Only the explicit `?sw=off` diagnostic path may ever unregister.

    });
  }


  const coordinator = coordinatorRef.current;

  const state = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => coordinator?.subscribe(onChange) ?? (() => {}),
      [coordinator],
    ),
    useCallback(() => coordinator?.getState() ?? IDLE_STATE, [coordinator]),
    () => IDLE_STATE,
  );

  /* ---------- registration + watchers ---------- */
  useEffect(() => {
    if (!coordinator) return;
    let disposed = false;
    const stopWatchers = startUpdateWatchers(coordinator, { win: window, doc: document });

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => (reg ? reg : navigator.serviceWorker.ready))
      .then((reg) => {
        if (disposed || !reg) return;
        coordinator.attach(reg as unknown as RegistrationLike);
        void coordinator.checkForUpdate("launch");
      })
      .catch(() => {
        /* no worker in dev/preview — the app simply never prompts */
      });




    return () => {
      disposed = true;
      stopWatchers?.();
    };
  }, [coordinator]);




  /* ---------- WO-145B fleet coordination ---------- */

  useEffect(() => {
    if (!coordinator) return;
    const channel = createBroadcastFleetChannel(CHANNEL_NAME);
    if (!channel) return;

    const fleet = new FleetCoordinator({
      channel,
      clientId: randomClientId(),
      buildId: LOADED_BUILD_ID,
      isDirty: () => hasUnsavedWork() || qc.isMutating() > 0,
      isVisible: () => document.visibilityState === "visible",
      onPeers: (count) => coordinator.notePeerCount(count),
      // Another client activated the new build. Converge exactly once.
      onCommit: ({ forced }) => coordinator.noteFleetCommit({ forced }),
      // The elected leader never committed (crash / close mid-coordination):
      // take over rather than wait forever.
      // WO-145F — a sibling is driving an update transaction. Enter the bounded
      // quiescent state so the outgoing worker has no residual work anywhere in
      // the fleet, and report exactly what this client can promise.
      onPrepare: (txnId) => {
        if (hasUnsavedWork() || qc.isMutating() > 0) return "blocked";
        try {
          beginQuiesce(txnId, { queryClient: qc });
          return "ready";
        } catch {
          return "unable";
        }
      },
      // The transaction was abandoned: restore queries, realtime and analytics
      // so this build keeps working normally.
      onPrepareCancel: (txnId) => {
        endQuiesce(txnId, { queryClient: qc });
      },
      onEscalate: () => {
        // WO-145E: same rule as the consented path — an outgoing worker with
        // realtime work in flight never hands over.
        quiesceBackendConnections();
        coordinator.applyUpdate({ force: false });
      },
    });
    fleetRef.current = fleet;
    fleet.start();

    return () => {
      fleet.stop();
      fleetRef.current = null;
    };
  }, [coordinator, qc]);

  // Announce a newly detected build to every sibling so prompts are fleet-wide
  // rather than tab-local (deduplicated by waiting token).
  const announcedTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.waitingToken === null) return;
    if (announcedTokenRef.current === state.waitingToken) return;
    announcedTokenRef.current = state.waitingToken;
    fleetRef.current?.announceAvailable();
  }, [state.waitingToken]);

  /* ---------- chunk-load recovery (stale build N under build N+1) ---------- */
  useEffect(() => {
    if (!coordinator) return;
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    return startChunkRecovery({
      storage,
      buildId: LOADED_BUILD_ID,
      reload: () => window.location.reload(),
      onUpdateRequired: (cause) => coordinator.enterUpdateRequired(cause),
      log: (cause) => logAnalyticsEvent("app_update_build_mismatch", { cause }),
    });
  }, [coordinator]);

  /* ---------- authenticated cache freshness ---------- */
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const outcome = reconcileBuildMarkers(storage);
    if (outcome === "build-changed" || outcome === "schema-changed") {
      invalidateCriticalQueries(qc);
      logAnalyticsEvent("app_update_reload_completed", { outcome });
    }
    void fetchDeployedBuildId().then((deployed) => {
      if (isBuildMismatch(deployed)) logAnalyticsEvent("app_update_build_mismatch", {});
    });
  }, [qc]);

  // WO-145B: session-critical reads (profile, avatar, unread count) refresh on
  // every foreground resume even when the build id has not changed, so a
  // server-side profile change becomes visible without signing out.
  useEffect(() => {
    refreshSessionCriticalQueries(qc);
    const onResume = () => {
      if (document.visibilityState === "visible") refreshSessionCriticalQueries(qc);
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
    };
  }, [qc]);

  /* ---------- actions ---------- */
  const checkNow = useCallback(async () => {
    if (!coordinator) return;
    await coordinator.checkForUpdate("manual");
    setTick((t) => t + 1);
  }, [coordinator]);

  /**
   * WO-145F — member-consented activation is a fleet-wide transaction:
   *
   *   1. refuse on local protected work (nothing else is disturbed);
   *   2. open a uniquely identified transaction and quiesce THIS client;
   *   3. ask every same-origin client to quiesce and acknowledge
   *      (`ready` / `blocked` / `unable`) within a short bounded window;
   *   4. only when every discovered responsive client is ready, post
   *      SKIP_WAITING once and reload this client exactly once;
   *   5. on any blocked outcome, cancel the transaction — every client restores
   *      normal behaviour — and tell the member specifically what is blocking,
   *      after rechecking the browser's real client set through the worker.
   */
  const updateNow = useCallback(
    (options?: { force?: boolean }) => {
      if (!coordinator) return;
      const force = options?.force === true;

      // Already stale (fleet commit or chunk failure): just reload this client.
      if (coordinator.isVersionSensitiveBlocked()) {
        const result = coordinator.reloadIfSafe({ force });
        if (result === "blocked") setUnsavedKinds(unsavedWorkKinds());
        return;
      }

      // Local protected work is refused before any sibling is disturbed.
      if (!force && (hasUnsavedWork() || qc.isMutating() > 0)) {
        coordinator.applyUpdate({ force: false });
        setUnsavedKinds(unsavedWorkKinds());
        return;
      }

      // Repeated clicks must not open a second transaction.
      if (txnRef.current !== null) return;
      const txnId = `txn-${randomClientId()}`;
      txnRef.current = txnId;
      setBlockedByPeers(0);
      setPeerBlocker(null);

      // This client quiesces first: it is a client of the same outgoing worker.
      beginQuiesce(txnId, { queryClient: qc });

      const fleet = fleetRef.current;
      const proceed = () => {
        // The commit is broadcast from `onActivated` — after the new worker is
        // active — so no sibling navigates through the outgoing worker while the
        // promotion this member asked for is still pending.
        const result = coordinator.applyUpdate({ force: true });
        if (result !== "activating") {
          endQuiesce(txnId, { queryClient: qc });
          txnRef.current = null;
        }
      };
      const abandon = (blocker: PeerBlocker, count: number) => {
        fleet?.cancelPreparation(txnId);
        endQuiesce(txnId, { queryClient: qc });
        txnRef.current = null;
        setBlockedByPeers(count);
        setPeerBlocker(blocker);
      };

      if (!fleet) {
        proceed();
        return;
      }

      setCoordinating(true);
      void fleet
        .prepareFleet(txnId, { force })
        .then(async (result) => {
          setCoordinating(false);
          if (result.outcome === "ready" || force) {
            proceed();
            return;
          }
          if (result.outcome === "blocked-dirty") {
            abandon("unsaved", result.dirty.length);
            return;
          }
          // Unresponsive or unable sibling: recheck the browser's real client
          // set before blaming a window that may already be gone.
          const census = await requestClientCensus();
          const stillThere = census === null || census.total > 1;
          if (!stillThere) {
            proceed();
            return;
          }
          abandon("unprepared", result.unable.length + result.silent.length);
        })
        .catch(() => {
          setCoordinating(false);
          proceed();
        });
    },
    [coordinator, qc],
  );


  const later = useCallback(() => {
    setUnsavedKinds([]);
    setBlockedByPeers(0);
    setPeerBlocker(null);
    coordinator?.dismiss();
  }, [coordinator]);

  const retry = useCallback(() => {
    coordinator?.retry();
  }, [coordinator]);

  const notePromptShown = useCallback(() => {
    coordinator?.notePromptShown();
  }, [coordinator]);

  const value = useMemo<PwaUpdateCtx>(
    () => ({
      state,
      visible: coordinator?.shouldPrompt() ?? false,
      buildId: LOADED_BUILD_ID,
      supported,
      unsavedKinds,
      coordinating,
      blockedByPeers,
      peerBlocker,
      checkNow,
      updateNow,
      later,
      retry,
      notePromptShown,
    }),
    // `tick` participates so a manual check refreshes derived values.
    [
      state,
      coordinator,
      supported,
      unsavedKinds,
      coordinating,
      blockedByPeers,
      peerBlocker,
      checkNow,
      updateNow,
      later,
      retry,
      notePromptShown,
      tick,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePwaUpdate(): PwaUpdateCtx {
  return useContext(Ctx);
}
