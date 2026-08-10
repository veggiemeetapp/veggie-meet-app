import { LoadingSkeleton, MeetupCardSkeleton } from "@/components/app";

export function TodaySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="px-5 pt-6 pb-4 space-y-3">
        <LoadingSkeleton className="h-6 w-2/3" />
        <LoadingSkeleton className="h-4 w-1/2" />
      </div>
      <div className="px-5">
        <LoadingSkeleton className="h-72 w-full rounded-dialog" />
      </div>
      <div className="px-5 mt-8 space-y-3">
        <LoadingSkeleton className="h-5 w-1/3" />
        <MeetupCardSkeleton />
        <MeetupCardSkeleton />
      </div>
    </div>
  );
}
