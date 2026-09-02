/**
 * WO-145B — chunk-load failure recovery.
 *
 * A member sitting on build N after build N+1 is deployed holds HTML/JS that
 * references hashed chunk filenames the origin no longer serves. Navigating to a
 * lazy route then rejects the dynamic import, which React surfaces as a blank
 * screen inside Suspense. The correct outcome is a *recoverable* update-required
 * state, never a blank screen and never a reload loop.
 *
 * Policy:
 *  - a chunk/preload failure is treated as proof of a build mismatch;
 *  - the client reloads exactly once per deployed build, guarded by a
 *    sessionStorage marker keyed to the build it recovered onto, so a genuinely
 *    broken asset can never produce an infinite loop;
 *  - if the guard has already fired, the app stays on the working build and asks
 *    the member to update instead.
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
}

export type RecoveryOutcome = "reloaded" | "update-required";

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

/** Decide and perform recovery. Pure with respect to the DOM except `reload`. */
export function recoverFromChunkFailure(deps: RecoveryDeps): RecoveryOutcome {
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

  try {
    deps.storage?.setItem(MARKER_KEY, deps.buildId);
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
    recoverFromChunkFailure(deps);
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
