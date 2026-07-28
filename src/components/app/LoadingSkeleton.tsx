import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export const LoadingSkeleton = forwardRef<HTMLDivElement, Props>(
  ({ className }, ref) => (
    <div ref={ref} className={cn("animate-pulse rounded-xl bg-muted", className)} />
  ),
);
LoadingSkeleton.displayName = "LoadingSkeleton";

export const MeetupCardSkeleton = forwardRef<HTMLDivElement>((_, ref) => (
  <div
    ref={ref}
    className="bg-card rounded-2xl border border-border/70 p-4 shadow-soft"
  >
    <LoadingSkeleton className="h-32 w-full mb-3" />
    <LoadingSkeleton className="h-4 w-2/3 mb-2" />
    <LoadingSkeleton className="h-3 w-1/2" />
  </div>
));
MeetupCardSkeleton.displayName = "MeetupCardSkeleton";
