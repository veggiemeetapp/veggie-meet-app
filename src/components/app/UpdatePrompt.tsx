/**
 * WO-145 / WO-145B — the single application-level update prompt.
 *
 * One prompt per waiting build per session, deduplicated fleet-wide by waiting
 * token. It is a polite, non-modal dialog for the "available" states so it never
 * traps focus or blocks the member's current task, and becomes assertive only in
 * the `update-required` state, where this client is knowingly stale.
 *
 * Accessibility contract:
 *  - `role="dialog"` with labelled title and described body;
 *  - a single polite live region (`aria-live` on the body only) so a state change
 *    is announced exactly once — the title is not also a live region;
 *  - focus moves to the primary action when the prompt appears and is restored
 *    to the previously focused element when it closes;
 *  - Escape maps to "Later" while an update is merely available, and is ignored
 *    while activating or update-required (there is nothing safe to dismiss to);
 *  - every action is at least 44px high, wraps rather than clipping at 320px,
 *    and the spinner respects `prefers-reduced-motion`.
 */
import { useEffect, useRef } from "react";
import { RefreshCw, AlertTriangle, WifiOff, Users } from "lucide-react";
import { usePwaUpdate } from "@/hooks/usePwaUpdate";
import { unsavedWorkSummary } from "@/lib/unsavedWork";

export function UpdatePrompt() {
  const {
    visible,
    state,
    unsavedKinds,
    coordinating,
    blockedByPeers,
    peerBlocker,

    updateNow,
    later,
    retry,
    notePromptShown,
  } = usePwaUpdate();
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    if (visible) notePromptShown();
  }, [visible, notePromptShown]);

  // Focus management: move focus in, restore it on close.
  useEffect(() => {
    if (!visible) return;
    restoreRef.current = document.activeElement;
    primaryRef.current?.focus();
    return () => {
      const target = restoreRef.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, [visible]);

  const required = state.status === "update-required";
  const activating = state.status === "activating";
  const failed = state.status === "failed";

  // Escape means "Later" only while there is something safe to postpone.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activating || required) return;
      later();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, activating, required, later]);

  if (!visible) return null;

  const blocked = state.blockedByUnsavedWork && unsavedKinds.length > 0;
  // WO-145F: when the application knows another client is the blocker, that
  // specific condition is reported — never the generic failure copy.
  const peerUnsaved = peerBlocker === "unsaved" || (blockedByPeers > 0 && peerBlocker === null);
  const peerUnprepared = peerBlocker === "unprepared";
  const peersBlocked = peerUnsaved || peerUnprepared;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const warn = failed || blocked || peersBlocked || required || offline;

  const title = peerUnprepared
    ? "Another VeggieMeet window is open"
    : failed
      ? "The update couldn't finish"
      : required
        ? "This window needs to update"
        : "A new version of VeggieMeet is available";

  const body = peerUnprepared
    ? "VeggieMeet is open in another window. Close that window, then try the update again."
    : failed
      ? "Your current version is still working. You can try again now or later."
      : required
        ? blocked
          ? `A newer version is already running elsewhere. You have ${unsavedWorkSummary(unsavedKinds)} — finish or save it, then reload. Reload anyway to discard it.`
          : "A newer version is now active. Reload this window to continue safely."
        : offline
          ? "You're offline. VeggieMeet keeps working on this version and will update when you're back online."
          : peerUnsaved
            ? "Another VeggieMeet window has unfinished work. The update will wait until it's saved or discarded there — or update anyway and lose it."
            : blocked
              ? `You have ${unsavedWorkSummary(unsavedKinds)}. Finish or save it first, or update anyway and lose it.`
              : coordinating
                ? "Getting your other VeggieMeet windows ready…"
                : "Update now to get the latest improvements.";

  const primaryLabel = activating
    ? "Updating…"
    : coordinating
      ? "Preparing…"
      : peerUnprepared
        ? "Try again"
        : failed
          ? "Try again"
          : required
            ? blocked
              ? "Reload anyway"
              : "Reload now"
            : blocked || peerUnsaved
              ? "Update anyway"
              : "Update now";

  const onPrimary = () => {
    // A specifically identified sibling blocker is retried as an ordinary,
    // non-forced update: closing that window is the resolution, not force.
    if (peerUnprepared) return updateNow();
    if (failed) return retry();
    return updateNow({ force: blocked || peerUnsaved || required });
  };


  const Icon = offline ? WifiOff : peersBlocked ? Users : warn ? AlertTriangle : RefreshCw;

  return (
    <div
      role="dialog"
      aria-modal={required ? true : undefined}
      aria-labelledby="app-update-title"
      aria-describedby="app-update-body"
      data-testid="app-update-prompt"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none"
    >
      <div
        className="pointer-events-auto w-full max-w-phone p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="rounded-card border border-border bg-card shadow-float p-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 shrink-0 rounded-card flex items-center justify-center ${
                warn
                  ? "bg-warning-soft text-warning-foreground"
                  : "bg-soft-green text-primary"
              }`}
            >
              <Icon
                className={`w-4.5 h-4.5 ${
                  activating || coordinating ? "motion-safe:animate-spin" : ""
                }`}
                aria-hidden
              />
            </div>
            <div className="flex-1 min-w-0">
              <p
                id="app-update-title"
                className="text-sm font-semibold text-charcoal break-words"
              >
                {title}
              </p>
              <p
                id="app-update-body"
                aria-live="polite"
                className="mt-1 text-xs text-charcoal-muted break-words"
              >
                {body}
                {!failed && !required && !blocked && !peersBlocked && state.peerCount > 0 && (
                  <> Your other VeggieMeet windows will update too.</>
                )}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              ref={primaryRef}
              type="button"
              onClick={onPrimary}
              disabled={activating || coordinating}
              className="flex-1 min-w-[8rem] min-h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold px-4 disabled:opacity-70"
            >
              {primaryLabel}
            </button>
            {!required && (
              <button
                type="button"
                onClick={later}
                className="min-h-11 rounded-full border border-border bg-card text-charcoal text-sm font-semibold px-4"
              >
                {blocked || peerUnsaved ? "Finish first" : "Later"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
