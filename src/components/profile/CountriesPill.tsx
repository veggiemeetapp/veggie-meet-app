import { Pencil } from "lucide-react";
import { WORLD_COUNTRY_COUNT, worldPercent } from "@/lib/countries";
import { cn } from "@/lib/utils";

/**
 * "3/195 countries · 1.5% of the world" chip. One tap opens the globe; the
 * pencil is decorative on the member's own profile (the whole pill is the
 * control) so there is a single, large hit target.
 */
export function CountriesPill({
  count,
  editable = false,
  onClick,
  className,
  variant = "light",
}: {
  count: number;
  editable?: boolean;
  onClick?: () => void;
  className?: string;
  /** "dark" is for the globe screen's top bar. */
  variant?: "light" | "dark";
}) {
  const label = `${count} of ${WORLD_COUNTRY_COUNT} countries, ${worldPercent(count)} percent of the world${editable ? ". Edit" : ""}`;
  const body = (
    <>
      <span
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0",
          variant === "dark" ? "bg-white/10" : "bg-soft-green",
        )}
        aria-hidden
      >
        🌍
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className={cn("block text-sm font-semibold tabular-nums", variant === "dark" ? "text-white" : "text-charcoal")}>
          {count}
          <span className={cn("font-normal", variant === "dark" ? "text-white/60" : "text-charcoal-muted")}>/{WORLD_COUNTRY_COUNT}</span>{" "}
          countries
        </span>
        <span className={cn("block text-[11px]", variant === "dark" ? "text-white/70" : "text-charcoal-muted")}>
          <span className="font-semibold text-primary">{worldPercent(count)}%</span> of the world
        </span>
      </span>
      {editable && (
        <span
          className="ml-1 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0"
          aria-hidden
        >
          <Pencil className="w-3.5 h-3.5" />
        </span>
      )}
    </>
  );
  const frame = cn(
    "inline-flex items-center gap-2 rounded-full pl-1.5 pr-2 py-1.5 border",
    variant === "dark" ? "bg-black/50 border-white/15 backdrop-blur" : "bg-card border-border",
    onClick && "transition-[transform,background-color] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    onClick && variant === "light" && "hover:bg-muted/50",
    className,
  );
  if (!onClick) {
    return (
      <span className={frame} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} className={frame}>
      {body}
    </button>
  );
}

export default CountriesPill;
