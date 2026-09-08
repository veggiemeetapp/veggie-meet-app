/**
 * WO-145B / WO-145R — chunk-load failure recovery.
 *
 * A member sitting on build N after build N+1 is deployed holds HTML/JS that
 * references hashed chunk filenames the origin no longer serves. Navigating to a
 * lazy route then rejects the dynamic import, which React surfaces as a blank
 * screen inside Suspense. The correct outcome is a *recoverable* update-required
 * state, never a blank screen and never a reload loop.
 *
 * WO-145R correction
 * ------------------
 * A dynamic-import failure is NOT proof of a stale build: an ordinary flaky
 * mobile connection produces exactly the same error. Reloading on it destroyed
 * unfinished member work (a half-written Meetup, an unsent message). So:
 *
 *  - a recovery reload consults the shared unsaved-work guard first, and when
 *    work exists nothing is reloaded — the member gets a safe recovery choice;
 *  - a reload only happens once an actual build mismatch is confirmed against
 *    the origin; a transient connectivity failure is reported as such and the
 *    member stays on the working build;
 *  - the once-per-build session marker still guarantees no reload loop.
 *
 * Nothing here clears caches, auth tokens, drafts, or offline data.
 */
const MARKER_KEY = "veggiemeet_chunk_recovery";

export interface RecoveryDeps {
  storage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
  } | null;
  buildId: string;
  reload: () => void;
  onUpdateRequired: (cause: string) => void;
  log?: (cause: string, properties?: Record<string, unknown>) => void;
  /**
   * WO-145R — the shared unsaved-work guard (drafts, uploads, composers, active
   * mutations). When it returns true no recovery reload may happen.
   */
  hasUnsavedWork?: () => boolean;
  /**
   * WO-145R — confirm a genuine build mismatch against the origin. Resolves
   * true only when the deployed build differs from the running one; false when
   * the build matches; null when it could not be determined (offline / 5xx).
   */
  confirmBuildMismatch?: () => Promise<boolean | null>;
  /** Offer the member a safe recovery choice instead of reloading. */
  onRecoveryChoice?: (cause: string) => void;
}

export type RecoveryOutcome =
  | "reloaded"
  | "update-required"
  /** WO-145R — unfinished work is protected; the member chooses. */
  | "deferred-unsaved-work"
  /** WO-145R — an ordinary connectivity failure; the build is fine. */
  | "transient-network";

/** True for the error shapes browsers/Vite use for a missing or stale chunk. */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  if (!message) return false;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed|dynamically imported module/i.test(
    message,
  );
}

/**
 * Decide and perform recovery. Pure with respect to the DOM except `reload`.
 *
 * Order of precedence, strongest safety first:
 *   1. unfinished member work → never reload, offer a choice;
 *   2. already recovered onto this build → recoverable update-required state;
 *   3. no bounded retry storage → recoverable update-required state;
 *   4. no confirmed build mismatch → treat as transient; stay on this build;
 *   5. confirmed mismatch → exactly one reload for this build id.
 */
export async function recoverFromChunkFailure(deps: RecoveryDeps): Promise<RecoveryOutcome> {
  // 1. Unfinished work always wins over any automatic reload.
  let dirty = false;
  try {
    dirty = deps.hasUnsavedWork?.() === true;
  } catch {
    dirty = false;
  }
  if (dirty) {
    deps.log?.("chunk_load_failed_unsaved_work");
    deps.onRecoveryChoice?.("chunk_load_failed_unsaved_work");
    deps.onUpdateRequired("chunk_load_failed_unsaved_work");
    return "deferred-unsaved-work";
  }

  let already: string | null = null;
  try {
    already = deps.storage?.getItem(MARKER_KEY) ?? null;
  } catch {
    already = null;
  }

  if (already === deps.buildId) {
    deps.log?.("chunk_load_failed_after_recovery");
    deps.onUpdateRequired("chunk_load_failed_after_recovery");
    return "update-required";
  }

  if (!deps.storage) {
    // Without storage we cannot bound retries, so we never reload: the member
    // gets a recoverable prompt instead of a possible reload loop.
    deps.log?.("chunk_load_failed_no_storage");
    deps.onUpdateRequired("chunk_load_failed_no_storage");
    return "update-required";
  }

  // 4. A dynamic-import failure is only stale-build evidence once the origin
  // confirms a different deployed build. Anything else is a network hiccup.
  if (deps.confirmBuildMismatch) {
    let mismatch: boolean | null = null;
    try {
      mismatch = await deps.confirmBuildMismatch();
    } catch {
      mismatch = null;
    }
    if (mismatch !== true) {
      deps.log?.("chunk_load_failed_transient_network", { confirmed: mismatch });
      deps.onRecoveryChoice?.("chunk_load_failed_transient_network");
      return "transient-network";
    }
  }

  try {
    deps.storage.setItem(MARKER_KEY, deps.buildId);
  } catch {
    // Private mode: fall back to the non-destructive branch so we can still
    // never loop.
    deps.log?.("chunk_load_failed_no_storage");
    deps.onUpdateRequired("chunk_load_failed_no_storage");
    return "update-required";
  }

  deps.log?.("chunk_load_recovery_reload");
  deps.reload();
  return "reloaded";
}

/** Attach the global listeners that surface stale-chunk failures. */
export function startChunkRecovery(deps: RecoveryDeps): () => void {
  if (typeof window === "undefined") return () => {};

  const handle = (error: unknown) => {
    if (!isChunkLoadError(error)) return;
    void recoverFromChunkFailure(deps);
  };

  const onError = (event: ErrorEvent) => handle(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => handle(event.reason);
  const onPreloadError = (event: Event) =>
    handle((event as unknown as { payload?: unknown }).payload ?? "Failed to fetch dynamically imported module");

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  // Vite's own signal for a failed module preload.
  window.addEventListener("vite:preloadError", onPreloadError);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("vite:preloadError", onPreloadError);
  };
}
