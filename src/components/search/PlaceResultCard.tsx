import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { Card } from "@/components/app";
import { ResultReasonPill } from "./ResultReasonPill";
import { sanitizeCover } from "@/lib/backend";
import type { PlaceResult } from "@/lib/search";

interface Props {
  result: PlaceResult;
}

export function PlaceResultCard({ result }: Props) {
  const location = result.neighborhood ?? result.city_name ?? result.address ?? "";
  return (
    <Link
      to={`/place/${result.entity_id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-card"
    >
      <Card interactive padding="none" className="overflow-hidden">
        <div className="flex gap-3">
          <img
            src={sanitizeCover(result.cover_image_url)}
            alt=""
            loading="lazy"
            className="w-24 h-24 object-cover shrink-0"
          />
          <div className="flex-1 min-w-0 py-3 pr-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold text-sm text-charcoal line-clamp-1">{result.name}</h3>
              <span className="text-[10px] font-medium text-charcoal-muted uppercase tracking-wider shrink-0">
                {result.category}
              </span>
            </div>
            {location && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-charcoal-muted">
                <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                <span className="truncate">{location}</span>
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-charcoal-muted">
                {result.upcoming_meetups_count > 0
                  ? `${result.upcoming_meetups_count} upcoming Meetup${result.upcoming_meetups_count === 1 ? "" : "s"}`
                  : "Community place"}
              </span>
              <ResultReasonPill label={result.reason_label} />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
