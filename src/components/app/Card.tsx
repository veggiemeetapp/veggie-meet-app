import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const padMap = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ interactive, padding = "md", className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-card rounded-2xl border border-border/70 shadow-soft",
        padMap[padding],
        interactive &&
          "transition-all cursor-pointer hover:shadow-card active:scale-[0.99]",
        className
      )}
      {...rest}
    />
  )
);
Card.displayName = "Card";
