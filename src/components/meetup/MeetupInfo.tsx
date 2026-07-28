import { Calendar, Clock, MapPin, Navigation } from "lucide-react";
import type { Meetup, CommunityPlace } from "@/types";
import { formatMeetupDate, formatTimeRange, formatDuration } from "@/lib/format";

interface Props {
  meetup: Meetup;
  place?: CommunityPlace;
  distanceKm?: number;
}

export function MeetupInfo({ meetup, place, distanceKm }: Props) {
  return (
    <div>
      <span className="inline-block text-[11px] font-semibold text-primary uppercase tracking-wider bg-soft-green px-2.5 py-1 rounded-full">
        {meetup.category}
      </span>
      <h1 className="mt-3 text-[26px] leading-tight font-semibold text-charcoal">
        {meetup.title}
      </h1>

      <div className="mt-5 space-y-3 text-[15px] text-charcoal">
        <Row icon={<Calendar className="w-4 h-4" />} label={formatMeetupDate(meetup.date)} />
        <Row
          icon={<Clock className="w-4 h-4" />}
          label={`${formatTimeRange(meetup.startTime, meetup.endTime)} · ${formatDuration(meetup.startTime, meetup.endTime)}`}
        />
        {(() => {
          const name = meetup.location?.locationName ?? meetup.customLocation?.name ?? place?.name;
          const addr = meetup.location?.address ?? meetup.customLocation?.address ?? place?.address;
          const cityName = meetup.location?.cityName ?? null;
          const neighborhood = meetup.location?.neighborhood ?? null;
          if (!name && !cityName) return null;
          const sub = [addr, neighborhood, cityName].filter(Boolean).join(" · ") || undefined;
          return (
            <Row
              icon={<MapPin className="w-4 h-4" />}
              label={name ?? cityName ?? "Location"}
              sub={sub}
            />
          );
        })()}

        {distanceKm != null && (
          <Row
            icon={<Navigation className="w-4 h-4" />}
            label={`${distanceKm.toFixed(1)} km away`}
          />
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, sub }: { icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-soft-green flex items-center justify-center text-primary shrink-0">
        {icon}
      </div>
      <div className="min-w-0 pt-1">
        <div className="text-charcoal font-medium leading-tight">{label}</div>
        {sub && <div className="text-charcoal-muted text-sm mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
