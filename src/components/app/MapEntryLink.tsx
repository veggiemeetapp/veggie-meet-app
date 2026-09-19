import { Link } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import { useMapAccess } from "@/components/app/RequireMapAccess";

/**
 * WO-154 — the only entry point to the private Map (navigation Option B).
 *
 * Renders nothing at all unless `has_map_access()` returns true for the signed-in
 * member, so bottom navigation and Today's layout are unchanged for everyone else.
 */
export function MapEntryLink({ className = "" }: { className?: string }) {
  const accessQ = useMapAccess();
  if (accessQ.data !== true) return null;

  return (
    <Link
      to="/map"
      aria-label="Open the Map"
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-charcoal transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      <MapIcon className="h-5 w-5" aria-hidden />
    </Link>
  );
}
