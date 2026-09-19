import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMapAccess } from "@/lib/memberMap";

/**
 * WO-154 — presentation gate for the private member-facing Map.
 *
 * Authorisation is server-side (`has_map_access()`), this component only keeps
 * an ungranted member from ever seeing Map chrome. Bottom navigation and Today
 * are untouched; the Map is reachable only by direct link for granted members.
 */
export function useMapAccess() {
  return useQuery({ queryKey: ["map-access"], queryFn: fetchMapAccess, staleTime: 5 * 60_000 });
}

export function RequireMapAccess({ children }: { children: JSX.Element }) {
  const accessQ = useMapAccess();

  if (accessQ.isLoading) return <div aria-hidden className="min-h-dvh" />;

  if (accessQ.data !== true) {
    return (
      <main role="main" className="flex min-h-dvh items-center justify-center page-x">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-charcoal">The Map isn't open yet</h1>
          <p className="mt-2 text-sm text-charcoal-muted">
            The VeggieMeet Map is still in a small private test. Community has everything
            happening near you in the meantime.
          </p>
          <Link
            to="/community"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Community
          </Link>
        </div>
      </main>
    );
  }

  return children;
}
