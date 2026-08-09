import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { logAnalyticsEvent } from "@/lib/analytics";

/**
 * WO-083 — connectivity hint banner.
 *
 * `navigator.onLine` is a hint, never proof of server reachability: it only
 * tells us the device has *a* network interface. RPC failure remains
 * authoritative, so this banner is presentation only and never gates
 * authorization or claims that data is current.
 *
 * Reconnect refetches active queries so canonical server state is restored,
 * but the refresh is debounced so rapid online/offline toggling can't turn into
 * a request storm.
 */
const RECONNECT_DEBOUNCE_MS = 750;

export function OfflineBanner() {
  const qc = useQueryClient();
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onOffline = () => {
      setOffline(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      logAnalyticsEvent("offline_detected", {});
    };
    const onOnline = () => {
      setOffline(false);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // Active queries only (React Query's default): mounted screens repair
        // themselves, background caches stay untouched until they are used.
        // Mutations are never replayed here.
        qc.invalidateQueries({ type: "active" });
        logAnalyticsEvent("reconnect_completed", {});
      }, RECONNECT_DEBOUNCE_MS);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [qc]);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 bg-amber-50 text-amber-900 border-b border-amber-200 px-4 py-2 text-xs text-center"
    >
      {/* Icon + text, never colour alone, so the state is perceivable without colour. */}
      <span className="inline-flex items-center gap-1.5">
        <WifiOff className="w-3.5 h-3.5" aria-hidden />
        You're offline. Some actions will be available when you reconnect.
      </span>
    </div>
  );
}
