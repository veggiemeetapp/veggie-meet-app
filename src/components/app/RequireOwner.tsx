import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isOwner } from "@/lib/placeVerification";

/**
 * WO-082 — single owner gate for every `/owner/*` route.
 *
 * Previously each owner screen decided for itself whether to render the
 * "Permission denied" state, and `/owner/member-reports` did not: a normal
 * member saw the owner queue chrome stuck on "Loading…" while the underlying
 * RPC (correctly) refused with "Not authorized". Authorization itself has
 * always been server-side; this component only makes the *presentation*
 * consistent so owner-only surfaces never render owner chrome to a member.
 */
export function RequireOwner({ children }: { children: JSX.Element }) {
  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });

  if (ownerQ.isLoading) {
    return <div aria-hidden className="min-h-dvh" />;
  }

  if (ownerQ.data !== true) {
    return (
      <main role="main" className="flex min-h-dvh items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-semibold text-charcoal">Permission denied</h1>
          <p className="mt-2 text-sm text-charcoal-muted">
            This area is limited to the VeggieMeet owner.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Back to Today
          </Link>
        </div>
      </main>
    );
  }

  return children;
}
