import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const qc = useQueryClient();
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      // Refetch active queries so route repairs missed data.
      qc.invalidateQueries();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [qc]);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 bg-amber-50 text-amber-900 border-b border-amber-200 px-4 py-2 text-xs text-center"
    >
      <span className="inline-flex items-center gap-1.5">
        <WifiOff className="w-3.5 h-3.5" aria-hidden />
        You're offline. Some actions will be available when you reconnect.
      </span>
    </div>
  );
}
