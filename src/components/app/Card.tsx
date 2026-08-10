import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * WO-092 card system.
 *
 * Five roles, one component. The visual difference between them is
 * intentional and carries meaning:
 *
 *  - `static`  (default) informational container. Quiet hairline border, no
 *              elevation, no pointer cursor. Must never look tappable.
 *  - `interactive` actionable/clickable card. Stronger border plus a press
 *              state and pointer cursor, so tappability is visible without
 *              relying on hover.
 *  - `metric`  Community Impact / stat tile. Inset surface, no border noise,
 *              equal weight between metrics.
 *  - `status`  state-carrying container (cancelled, pending, verified). Border
 *              is quiet; the badge inside carries the meaning.
 *  - `form`    form/section container. Quiet border, larger default padding.
 */
type Variant = "static" | "interactive" | "metric" | "status" | "form";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Back-compat shorthand for `variant="interactive"`. */
  interactive?: boolean;
  variant?: Variant;
  padding?: "none" | "sm" | "md" | "lg";
}

const padMap = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const variantMap: Record<Variant, string> = {
  static: "bg-card border border-border",
  interactive:
    "bg-card border border-border-strong shadow-soft cursor-pointer transition-[transform,box-shadow,background-color] duration-150 hover:shadow-card active:scale-[0.99]",
  metric: "bg-muted/60 border border-transparent",
  status: "bg-card border border-border",
  form: "bg-card border border-border",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ interactive, variant, padding, className, ...rest }, ref) => {
    const resolved: Variant = variant ?? (interactive ? "interactive" : "static");
    const pad = padding ?? (resolved === "form" ? "lg" : "md");
    return (
      <div
        ref={ref}
        className={cn("rounded-card", variantMap[resolved], padMap[pad], className)}
        {...rest}
      />
    );
  },
);
Card.displayName = "Card";
