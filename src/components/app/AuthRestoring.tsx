import { useEffect, useState } from "react";
import { Sprout, WifiOff } from "lucide-react";

/**
 * WO-145Q (corrected) — branded authentication restoration state.
 *
 * Restoration never falls back to the welcome/auth screens. While a persisted
 * session is being restored the member sees this; if the restore is still
 * unresolved after the bounded window (`gate === "delayed"`) the same screen
 * becomes honest about it and offers a retry, plus offline guidance when the
 * device reports no connection. Member data is never touched, nothing is signed
 * out, and no cache is cleared.
 */
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

  useEffect(() => {
    const sync = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const heading = delayed
    ? offline
      ? "Waiting for your connection"
      : "Still restoring your session"
    : "Restoring your session…";

  const body = delayed
    ? offline
      ? "You appear to be offline. You are still signed in — reconnect and this will continue on its own. Nothing has been lost."
      : "This is taking longer than usual on this connection. You are still signed in and nothing has been lost."
    : "One moment while we bring your profile and meetups back.";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={delayed ? "auth-restoring-delayed" : "auth-restoring"}
      className="flex-1 min-h-[70dvh] flex flex-col items-center justify-center gap-4 px-6 text-center"
    >
      {delayed && offline ? (
        <WifiOff className="w-10 h-10 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Sprout
          className="w-10 h-10 text-primary motion-safe:animate-fade-in"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      )}
      <div className="w-32 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-primary motion-safe:animate-route-progress motion-reduce:w-full" />
      </div>
      <h1 className="text-base font-semibold text-foreground">{heading}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{body}</p>
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
