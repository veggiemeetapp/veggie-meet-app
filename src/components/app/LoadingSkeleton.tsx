import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * WO-092 loading treatment: skeletons share the card radius family and the
 * same pulse. `prefers-reduced-motion` collapses the pulse globally (WO-085).
 */
interface Props {
  className?: string;
}

export const LoadingSkeleton = forwardRef<HTMLDivElement, Props>(
  ({ className }, ref) => (
    <div ref={ref} className={cn("animate-pulse rounded-control bg-muted", className)} />
  ),
);
LoadingSkeleton.displayName = "LoadingSkeleton";

export const MeetupCardSkeleton = forwardRef<HTMLDivElement>((_, ref) => (
  <div ref={ref} className="bg-card rounded-card border border-border p-4">
    <LoadingSkeleton className="h-32 w-full mb-3" />
    <LoadingSkeleton className="h-4 w-2/3 mb-2" />
    <LoadingSkeleton className="h-3 w-1/2" />
  </div>
));
MeetupCardSkeleton.displayName = "MeetupCardSkeleton";
