import { CalendarX } from "lucide-react";
import type { Meetup } from "@/types";
import { EmptyState, MeetupCard, SectionHeader } from "@/components/app";

interface Props {
  meetups: Meetup[];
}

export function TodayMeetupsSection({ meetups }: Props) {
  return (
    <section>
      <SectionHeader
        title="Today’s Meetups"
        subtitle="Small tables. Real people."
      />
      {meetups.length === 0 ? (
        <EmptyState
          icon={<CalendarX className="w-6 h-6" />}
          title="No meetups today"
          description="Check back tomorrow — or host one yourself."
        />
      ) : (
        <div className="px-5 space-y-4">
          {meetups.map((m) => (
            <MeetupCard key={m.id} meetup={m} />
          ))}
        </div>
      )}
    </section>
  );
}
