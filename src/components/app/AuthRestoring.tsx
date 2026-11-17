import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * WO-145Q (corrected) — branded authentication restoration state.
 *
 * Restoration never falls back to the welcome/auth screens. While a persisted
 * session is being restored the member sees this; if the restore is still
 * unresolved after the bounded window (`gate === "delayed"`) the same screen
 * becomes honest about it and offers a retry, plus offline guidance when the
 * device reports no connection. Member data is never touched, nothing is signed
 * out, and no cache is cleared.
 *
 * Presentation (2026-11-17): the normal restore is a plain branded splash —
 * app logo and progress bar, no copy — because "Restoring your session…" on
 * every cold start read as an error to members. A neutral "Loading…" line only
 * appears if the restore is still running after QUIET_MS. The delayed state is
 * unchanged: it must explain itself and offer retry. Screen readers still get
 * a polite status announcement from the first frame.
 */

/** How long the normal restore stays wordless before a neutral hint appears. */
export const AUTH_RESTORING_QUIET_MS = 2_000;

export function AuthRestoring({
  delayed = false,
  onRetry,
}: {
  delayed?: boolean;
  onRetry?: () => void;
}) {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );
  const [quiet, setQuiet] = useState(true);

  useEffect(() => {
    const sync = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuiet(false), AUTH_RESTORING_QUIET_MS);
    return () => window.clearTimeout(t);
  }, []);

  const heading = delayed
    ? offline
      ? "Waiting for your connection"
      : "Still restoring your session"
    : quiet
      ? null
      : "Loading…";

  const body = delayed
    ? offline
      ? "You appear to be offline. You are still signed in — reconnect and this will continue on its own. Nothing has been lost."
      : "This is taking longer than usual on this connection. You are still signed in and nothing has been lost."
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={delayed ? undefined : "Loading VeggieMeet"}
      data-testid={delayed ? "auth-restoring-delayed" : "auth-restoring"}
      className="flex-1 min-h-[70dvh] flex flex-col items-center justify-center gap-4 px-6 text-center"
    >
      {delayed && offline ? (
        <WifiOff className="w-10 h-10 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <img
          src="/app-icon-192.png"
          alt=""
          width={72}
          height={72}
          draggable={false}
          className="w-[72px] h-[72px] rounded-2xl motion-safe:animate-fade-in select-none"
          aria-hidden="true"
        />
      )}
      <div className="w-32 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-primary motion-safe:animate-route-progress motion-reduce:w-full" />
      </div>
      {heading && <h1 className="text-base font-semibold text-foreground">{heading}</h1>}
      {body && <p className="max-w-xs text-sm text-muted-foreground">{body}</p>}
      {delayed && (
        <button
          type="button"
          onClick={() => (onRetry ? onRetry() : window.location.reload())}
          className="mt-2 min-h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export default AuthRestoring;
