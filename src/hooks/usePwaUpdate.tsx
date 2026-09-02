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
import { consumeActivationRecoveryBudget } from "@/lib/activationRecovery";
import {
  LOADED_BUILD_ID,
  fetchDeployedBuildId,
  invalidateCriticalQueries,
  isBuildMismatch,
  reconcileBuildMarkers,
  refreshSessionCriticalQueries,
} from "@/lib/buildFreshness";
import { hasUnsavedWork, unsavedWorkKinds, type UnsavedWorkKind } from "@/lib/unsavedWork";

/** sessionStorage is unavailable in private modes and inside some webviews. */
function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}


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
      // WO-145C: bridge for clients still controlled by the previously
      // published `skipWaiting: true` worker, which can hold the first
      // prompt-mode worker in `waiting` for as long as this client lives.
      allowRecoveryReload: () =>
        consumeActivationRecoveryBudget(sessionStorageOrNull(), LOADED_BUILD_ID),
      // Only the worker registration is released — caches, tokens and drafts
      // are untouched, and the guarded registrar reinstalls on the next boot.
      releaseRegistration: async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg ? reg.unregister() : false;
      },

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
    let stopWatchers: (() => void) | undefined;

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

    stopWatchers = startUpdateWatchers(coordinator, {
      win: window,
      doc: document,
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
      onEscalate: () => coordinator.applyUpdate({ force: false }),
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

      const fleet = fleetRef.current;
      if (!fleet) {
        coordinator.applyUpdate({ force });
        return;
      }

      setCoordinating(true);
      void fleet
        .requestActivation({ force })
        .then((decision) => {
          setCoordinating(false);
          coordinator.notePeerCount(decision.peers.length);
          if (decision.outcome === "blocked-dirty") {
            setBlockedByPeers(decision.dirtyPeers);
            return;
          }
          setBlockedByPeers(0);
          // A deferred client waits for the leader's commit; its bounded
          // escalation timer prevents a deadlock.
          if (decision.outcome === "deferred") return;
          fleet.commitActivation(force);
          coordinator.applyUpdate({ force: true });
        })
        .catch(() => {
          setCoordinating(false);
          coordinator.applyUpdate({ force });
        });
    },
    [coordinator, qc],
  );

  const later = useCallback(() => {
    setUnsavedKinds([]);
    setBlockedByPeers(0);
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
