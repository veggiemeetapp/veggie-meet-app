import { Link } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";

/**
 * Compact secondary entry point to the same Explore map exposed in BottomNav.
 */
export function MapEntryLink({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="Open the Map"
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-charcoal transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      <MapIcon className="h-5 w-5" aria-hidden />
    </Link>
  );
}
