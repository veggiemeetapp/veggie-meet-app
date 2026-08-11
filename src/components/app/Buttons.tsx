import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * WO-092 button hierarchy.
 *
 * Height scale is fixed so controls line up across surfaces, and no size drops
 * below the 44px accessible target established in WO-085.
 *
 *  Primary     — filled green. One dominant action per surface.
 *  Secondary   — tinted surface with a strong border. Clearly subordinate.
 *  Tertiary    — text-only. Lightest weight, for low-stakes navigation.
 *  Destructive — destructive text on a quiet tinted surface, so it reads as
 *                dangerous without shouting louder than the primary action.
 */
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  fullWidth?: boolean;
}

/* WO-095B DEF-095A-05: heights are minimums, not fixed values. At enlarged root
   font sizes a fixed `h-11`/`h-12` clipped the label vertically while the
   nowrap label pushed the document sideways. Padding keeps the 44px target. */
const sizeClasses: Record<Size, string> = {
  sm: "min-h-11 px-4 py-2 text-sm",
  md: "min-h-11 px-5 py-2 text-[15px]",
  lg: "min-h-12 px-6 py-2.5 text-base",
};

const base =
  // `max-w-full` + wrapping labels: a long label wraps inside the control
  // instead of overflowing the page at 200%+ text.
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold text-center " +
  "max-w-full whitespace-normal break-words " +
  "transition-[transform,background-color,box-shadow,color] duration-150 active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:opacity-50 disabled:pointer-events-none";


function make(
  displayName: string,
  tone: string,
  defaultSize: Size = "lg",
) {
  const Component = forwardRef<HTMLButtonElement, Props>(
    ({ size = defaultSize, fullWidth, className, children, type = "button", ...rest }, ref) => (
      <button
        ref={ref}
        type={type}
        className={cn(base, tone, sizeClasses[size], fullWidth && "w-full", className)}
        {...rest}
      >
        {children}
      </button>
    ),
  );
  Component.displayName = displayName;
  return Component;
}

export const PrimaryButton = make(
  "PrimaryButton",
  "bg-primary text-primary-foreground shadow-soft hover:bg-primary/90",
);

export const SecondaryButton = make(
  "SecondaryButton",
  "bg-secondary text-charcoal border border-border-strong hover:bg-accent",
);

export const TertiaryButton = make(
  "TertiaryButton",
  "bg-transparent text-charcoal-muted font-medium hover:text-charcoal hover:bg-muted",
  "md",
);

export const DestructiveButton = make(
  "DestructiveButton",
  "bg-destructive/10 text-destructive border border-destructive/25 hover:bg-destructive/15",
);
