import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, AvatarGroup } from "@/components/app";
import type { Veggie } from "@/types";

interface Props {
  attendees: Veggie[];
  totalCount: number;
  capacity: number;
  meetupId: string;
}

export function AttendeePreview({ attendees, totalCount, capacity, meetupId }: Props) {
  return (
    <Card padding="md" interactive className="p-0 overflow-hidden">
      <Link to={`/group/${meetupId}`} className="flex items-center gap-3 p-4">
        <AvatarGroup users={attendees} max={4} size="md" totalCount={totalCount} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-charcoal">
            {totalCount} joining · {capacity - totalCount} spots left
          </div>
          <div className="text-xs text-charcoal-muted mt-0.5">Meet the group</div>
        </div>
        <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
      </Link>
    </Card>
  );
}
