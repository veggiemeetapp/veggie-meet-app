import { Link } from "react-router-dom";
import { Calendar, MapPin, Users } from "lucide-react";
import { Card, ProgressiveImage } from "@/components/app";
import { ResultReasonPill } from "./ResultReasonPill";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { FALLBACK_COVER, sanitizeCover } from "@/lib/backend";
import { useMeetupCategoryLabel } from "@/lib/meetupCategory";
import type { MeetupResult } from "@/lib/search";

interface Props {
  result: MeetupResult;
}

export function MeetupResultCard({ result }: Props) {
  // WO-126A — canonical Primary label, legacy enum only as historical fallback.
  const categoryLabel = useMeetupCategoryLabel(result.primary_interest_id, result.category);
  const location =
    result.location_name ??
    result.neighborhood ??
    result.city_name ??
    "Location to be confirmed";
  return (
    <Link
      to={`/meetup/${result.entity_id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-card"
    >
      <Card interactive padding="none" className="overflow-hidden">
        <div className="flex gap-3">
          <ProgressiveImage
            src={sanitizeCover(result.cover_image_url)}
            fallbackSrc={FALLBACK_COVER}
            alt=""
            loading="lazy"
            containerClassName="w-24 h-24 shrink-0"
          />
          <div className="flex-1 min-w-0 py-3 pr-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold text-sm text-charcoal line-clamp-1">{result.title}</h3>
              {categoryLabel && (
                <span className="text-[10px] font-medium text-charcoal-muted uppercase tracking-wider shrink-0">
                  {categoryLabel}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-charcoal-muted">
              <Calendar className="w-3 h-3 shrink-0" aria-hidden />
              <span className="truncate">
                {formatMeetupDate(result.date)} · {formatTime12h(result.start_time.slice(0, 5))}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-charcoal-muted">
              <MapPin className="w-3 h-3 shrink-0" aria-hidden />
              <span className="truncate">{location}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                <Users className="w-3 h-3" aria-hidden />
                {result.attendee_count} / {result.capacity}
                {result.is_full && <span className="text-charcoal-muted">· Full</span>}
              </span>
              <ResultReasonPill label={result.reason_label} />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
