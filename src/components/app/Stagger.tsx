import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Reveals its children one after another (rise + fade, 40 ms apart) the first
 * time they render. Wrap a grid or list; each direct child gets its own delay.
 * Delays are capped so a long list never waits more than ~0.5 s.
 */
export function Stagger({
  children,
  className,
  step = 40,
  maxDelay = 480,
  itemClassName,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  maxDelay?: number;
  itemClassName?: string;
}) {
  const items = Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, i) => (
        <div
          key={(child as { key?: string | number | null })?.key ?? i}
          className={cn("motion-safe:animate-rise-in", itemClassName)}
          style={{ animationDelay: `${Math.min(i * step, maxDelay)}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export default Stagger;
