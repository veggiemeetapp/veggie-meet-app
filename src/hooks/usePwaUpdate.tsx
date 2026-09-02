/**
 * WO-145 — React binding for the update coordinator.
 *
 * Owns exactly three things:
 *  - construct one coordinator per client and attach the real registration;
 *  - run the required update checks (launch / foreground / focus / reconnect /
 *    interval / manual) and coordinate sibling tabs over BroadcastChannel;
 *  - reconcile authenticated cache freshness when the loaded build changes.
 *
 * Everything decision-shaped lives in `src/lib/pwaUpdate.ts` so it stays
 * testable without a DOM service worker.
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
  LOADED_BUILD_ID,
  fetchDeployedBuildId,
  invalidateCriticalQueries,
  isBuildMismatch,
  reconcileBuildMarkers,
} from "@/lib/buildFreshness";
import { hasUnsavedWork, unsavedWorkKinds, type UnsavedWorkKind } from "@/lib/unsavedWork";

const IDLE_STATE: UpdateState = {
  status: "idle",
  waitingToken: null,
  dismissedToken: null,
  checking: false,
  blockedByUnsavedWork: false,
  otherClientsLikely: false,
  lastCheckAt: null,
};

interface PwaUpdateCtx {
  state: UpdateState;
  /** True when the accessible update prompt should render. */
  visible: boolean;
  buildId: string;
  supported: boolean;
  unsavedKinds: UnsavedWorkKind[];
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

  // A single coordinator for the lifetime of the client.
  const coordinatorRef = useRef<UpdateCoordinator | null>(null);
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;

  if (supported && !coordinatorRef.current) {
    coordinatorRef.current = new UpdateCoordinator({
      container: navigator.serviceWorker as unknown as ContainerLike,
      reload: () => {
        logAnalyticsEvent("app_update_reload_completed", { phase: "requested" });
        window.location.reload();
      },
      now: () => Date.now(),
      log: (event, properties) => logAnalyticsEvent(event, properties),
      // Active mutations count as work in progress: a reload mid-write would
      // leave the member unsure whether their action landed.
      hasUnsavedWork: () => hasUnsavedWork() || qc.isMutating() > 0,
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

  /* ---------- sibling tab/window coordination ---------- */
  useEffect(() => {
    if (!coordinator || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (type === "hello") {
        coordinator.noteOtherClients(true);
        channel.postMessage({ type: "here" });
      } else if (type === "here") {
        coordinator.noteOtherClients(true);
      } else if (type === "activating") {
        // Another client is activating. We do NOT reload here: this client may
        // be mid-form. Its own controllerchange is ignored unless it asked.
        coordinator.noteOtherClients(true);
      }
    };
    channel.postMessage({ type: "hello" });
    return () => channel.close();
  }, [coordinator]);

  /* ---------- authenticated cache freshness after a build change ---------- */
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

  /* ---------- actions ---------- */
  const checkNow = useCallback(async () => {
    if (!coordinator) return;
    await coordinator.checkForUpdate("manual");
    setTick((t) => t + 1);
  }, [coordinator]);

  const updateNow = useCallback(
    (options?: { force?: boolean }) => {
      if (!coordinator) return;
      const result = coordinator.applyUpdate(options ?? {});
      if (result === "blocked") setUnsavedKinds(unsavedWorkKinds());
    },
    [coordinator],
  );

  const later = useCallback(() => {
    setUnsavedKinds([]);
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
      checkNow,
      updateNow,
      later,
      retry,
      notePromptShown,
    }),
    // `tick` participates so a manual check refreshes derived values.
    [state, coordinator, supported, unsavedKinds, checkNow, updateNow, later, retry, notePromptShown, tick],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePwaUpdate(): PwaUpdateCtx {
  return useContext(Ctx);
}
