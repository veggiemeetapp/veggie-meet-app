import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import type { JSX } from "react";
import { isUuid } from "@/lib/backend";

/**
 * WO-082 — neutral "resource unavailable" state.
 *
 * Used for a valid route whose resource cannot be shown: malformed id,
 * deleted, or not visible to this member. It never states *why*, so it cannot
 * leak deletion, privacy or block direction.
 */
export function ResourceUnavailable({
  backTo = "/",
  backLabel = "Return to Today",
}: {
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <main
      role="main"
      className="flex min-h-dvh items-center justify-center bg-background px-6"
    >
      <div className="text-center max-w-sm">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-charcoal">
          Not available
        </h1>
        <p className="mb-6 text-sm text-charcoal-muted leading-relaxed">
          This content isn't available right now.
        </p>
        <Link
          to={backTo}
          className="inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          {backLabel}
        </Link>
      </div>
    </main>
  );
}

/** Route params that must be canonical UUIDs before any request is made. */
const UUID_PARAMS = [
  "id",
  "meetupId",
  "placeId",
  "conversationId",
  "otherProfileId",
] as const;

/**
 * Blocks malformed resource ids at the route boundary so they never reach a
 * `uuid`-typed RPC argument (which would surface a raw PostgreSQL
 * "invalid input syntax for type uuid" message to the member).
 */
export function RequireValidIds({ children }: { children: JSX.Element }) {
  const params = useParams();
  const bad = UUID_PARAMS.some((k) => {
    const v = params[k];
    return typeof v === "string" && v.length > 0 && !isUuid(v);
  });
  if (bad) return <ResourceUnavailable />;
  return children;
}
