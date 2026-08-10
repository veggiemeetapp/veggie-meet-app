import { ButtonHTMLAttributes, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WO-092 icon button.
 *
 * One container size (44px), one icon size (20px), one stroke weight. Every
 * header/inline icon control on the product uses this so icons stop drifting
 * between 16, 18, 20 and 24px containers. An accessible name is required.
 */
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  tone?: "default" | "muted" | "destructive";
  shape?: "circle" | "square";
}

const toneMap = {
  default: "text-charcoal hover:bg-muted",
  muted: "text-charcoal-muted hover:bg-muted hover:text-charcoal",
  destructive: "text-destructive hover:bg-destructive/10",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, tone = "default", shape = "circle", type = "button", children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center w-11 h-11 shrink-0",
        shape === "circle" ? "rounded-full" : "rounded-control",
        "transition-colors duration-150 active:scale-[0.96]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-50 disabled:pointer-events-none",
        "[&_svg]:w-5 [&_svg]:h-5 [&_svg]:shrink-0",
        toneMap[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";

/**
 * WO-092 back control. Same position, size and icon on every detail surface.
 * Uses history when there is somewhere to go back to, otherwise a safe fallback
 * route, so deep links never dead-end (WO-082 navigation guarantees).
 */
export function BackButton({
  fallback = "/",
  label = "Go back",
  className,
  onClick,
}: {
  fallback?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <IconButton
      aria-label={label}
      className={cn("-ml-2", className)}
      onClick={() => {
        if (onClick) return onClick();
        if (window.history.length > 1) navigate(-1);
        else navigate(fallback, { replace: true });
      }}
    >
      <ArrowLeft aria-hidden="true" />
    </IconButton>
  );
}
