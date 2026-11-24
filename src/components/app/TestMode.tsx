import { FlaskConical, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setTestMode, useTestMode } from "@/lib/testMode";
import { resetCollectionMock } from "@/lib/collectionMock";
import { resetMockCountries } from "@/lib/profileCountriesMock";
import { cn } from "@/lib/utils";

/**
 * Owner-only Test mode switch, placed beside the theme toggle on You.
 * The parent decides whether to render it (owner check); this component only
 * flips the per-device flag and resets the sample data on every turn-on so a
 * review always starts from the same state.
 */
export function TestModeToggle({ className }: { className?: string }) {
  const on = useTestMode();
  const qc = useQueryClient();
  const toggle = () => {
    const next = !on;
    if (next) {
      resetCollectionMock();
      resetMockCountries();
    }
    setTestMode(next);
    qc.invalidateQueries({ queryKey: ["collection"] });
    qc.invalidateQueries({ queryKey: ["profile-countries"] });
    toast(next ? "Test mode on" : "Test mode off", {
      description: next
        ? "Collection screens now show sample data. Nothing is saved to the server."
        : "Back to live data.",
    });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Turn test mode off" : "Turn test mode on"}
      title={on ? "Test mode is on" : "Test mode"}
      data-testid="test-mode-toggle"
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "text-charcoal hover:bg-accent",
        className,
      )}
    >
      <FlaskConical className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/** Persistent strip under the header while Test mode is on, so sample data is never mistaken for real. */
export function TestModeBanner() {
  const on = useTestMode();
  if (!on) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex items-center gap-2 px-4 py-1.5 text-xs font-medium bg-amber-500/15 text-amber-800 dark:text-amber-200 border-b border-amber-500/30"
      data-testid="test-mode-banner"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">Test mode: Collection shows sample data. Nothing is saved.</span>
      <button
        type="button"
        onClick={() => setTestMode(false)}
        aria-label="Turn test mode off"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-amber-500/20"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
