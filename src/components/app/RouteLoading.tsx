import { useEffect, useState } from "react";
import { Sprout } from "lucide-react";

/**
 * WO-121 — branded route-transition loading state.
 *
 * The router's Suspense boundary lives inside `AppShell`'s `<main>`, so this
 * renders only in the content area: the header chrome and the bottom navigation
 * stay mounted and the selected destination updates immediately.
 *
 * Behaviour notes:
 * - No artificial minimum duration. The loader unmounts the moment the lazy
 *   chunk resolves, so ready/cached routes never pay a delay.
 * - A small delayed reveal (`delayMs`) keeps fast cached transitions flicker
 *   free while still guaranteeing feedback for genuinely slow ones.
 * - `role="status"` + a single polite announcement; focus is never moved here,
 *   so post-navigation focus handling in `AppShell` stays correct.
 * - Motion collapses under `prefers-reduced-motion` (static bar, no pulse).
 */
export function RouteLoading({ delayMs = 150 }: { delayMs?: number }) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const t = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);

  if (!visible) return <div aria-hidden className="min-h-dvh" />;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="route-loading"
      className="flex-1 min-h-[60dvh] flex flex-col items-center justify-center gap-4 px-6"
    >
      <Sprout
        className="w-10 h-10 text-primary motion-safe:animate-fade-in"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <div className="w-32 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-primary motion-safe:animate-route-progress motion-reduce:w-full" />
      </div>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
