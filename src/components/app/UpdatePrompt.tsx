/**
 * WO-145 — the single application-level update prompt.
 *
 * One prompt per waiting build per session. It is a polite, non-modal dialog so
 * it never traps focus or blocks the member's current task: they can keep using
 * build A and update when convenient. It renders inside the phone-width shell,
 * above the bottom navigation, and works identically in installed-PWA and
 * ordinary browser modes.
 */
import { useEffect, useRef } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { usePwaUpdate } from "@/hooks/usePwaUpdate";
import { unsavedWorkSummary } from "@/lib/unsavedWork";

export function UpdatePrompt() {
  const {
    visible,
    state,
    unsavedKinds,
    updateNow,
    later,
    retry,
    notePromptShown,
  } = usePwaUpdate();
  const headingRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (visible) notePromptShown();
  }, [visible, notePromptShown]);

  if (!visible) return null;

  const failed = state.status === "failed";
  const activating = state.status === "activating";
  const blocked = state.blockedByUnsavedWork && unsavedKinds.length > 0;

  return (
    <div
      role="dialog"
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
                failed || blocked
                  ? "bg-warning-soft text-warning-foreground"
                  : "bg-soft-green text-primary"
              }`}
            >
              {failed || blocked ? (
                <AlertTriangle className="w-4.5 h-4.5" aria-hidden />
              ) : (
                <RefreshCw
                  className={`w-4.5 h-4.5 ${activating ? "animate-spin" : ""}`}
                  aria-hidden
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                id="app-update-title"
                ref={headingRef}
                className="text-sm font-semibold text-charcoal break-words"
              >
                {failed
                  ? "The update couldn't finish"
                  : "A new version of VeggieMeet is available"}
              </p>
              <p id="app-update-body" className="mt-1 text-xs text-charcoal-muted break-words">
                {failed
                  ? "Your current version is still working. You can try again now or later."
                  : blocked
                    ? `You have ${unsavedWorkSummary(unsavedKinds)}. Finish or save it first, or update anyway and lose it.`
                    : "Update now to get the latest improvements."}
                {!failed && !blocked && state.otherClientsLikely && (
                  <>
                    {" "}
                    If the update doesn't finish, close any other VeggieMeet window.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => (failed ? retry() : updateNow({ force: blocked }))}
              disabled={activating}
              className="flex-1 min-h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold px-4 disabled:opacity-70"
            >
              {activating
                ? "Updating…"
                : failed
                  ? "Try again"
                  : blocked
                    ? "Update anyway"
                    : "Update now"}
            </button>
            <button
              type="button"
              onClick={later}
              className="min-h-11 rounded-full border border-border bg-card text-charcoal text-sm font-semibold px-4"
            >
              {blocked ? "Finish first" : "Later"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
