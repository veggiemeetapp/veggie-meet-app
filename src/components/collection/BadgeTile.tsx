import { ChevronRight } from "lucide-react";
import type { BadgeProgress } from "@/lib/collection";
import { cn } from "@/lib/utils";

export function BadgeTile({
  badge,
  onClick,
  isNew = false,
}: {
  badge: BadgeProgress;
  onClick?: () => void;
  /** Earned since the member last looked: plays the unlock animation and shows "New". */
  isNew?: boolean;
}) {
  const pct = Math.round((badge.progress / badge.target) * 100);
  const body = (
    <>
      <div
        className={cn(
          "w-11 h-11 rounded-full flex items-center justify-center text-2xl shrink-0",
          badge.earned ? "bg-card" : "bg-muted grayscale opacity-70",
          isNew && "motion-safe:animate-unlock",
        )}
        aria-hidden
      >
        {badge.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-charcoal truncate">{badge.name}</div>
          {badge.earned ? (
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                isNew ? "bg-primary text-primary-foreground motion-safe:animate-pop" : "bg-primary/10 text-primary",
              )}
            >
              {isNew ? "New" : "Earned"}
            </span>
          ) : (
            <span className="text-[10px] text-charcoal-muted tabular-nums shrink-0">
              {badge.progress}/{badge.target}
            </span>
          )}
        </div>
        <p className="text-xs text-charcoal-muted mt-0.5">{badge.description}</p>
        {!badge.earned && badge.target > 1 && (
          <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full motion-safe:transition-[width] motion-safe:duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      {onClick && <ChevronRight className="w-4 h-4 text-charcoal-muted shrink-0 self-center" aria-hidden />}
    </>
  );
  const frame = cn(
    "w-full text-left rounded-card border p-3 flex items-start gap-3",
    badge.earned ? "bg-soft-green border-primary/30" : "bg-card border-border",
    isNew && "ring-2 ring-primary/40",
  );
  const label = `${badge.name}${badge.earned ? ", earned" : `, ${badge.progress} of ${badge.target}`}`;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}. Show details`}
        className={cn(frame, "transition-[background-color,transform] active:scale-[0.98] hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40")}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={frame} aria-label={label}>
      {body}
    </div>
  );
}

export default BadgeTile;
