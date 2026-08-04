import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Leaf, MapPin, Navigation } from "lucide-react";
import { fetchCommunityPlaceById, isUuid } from "@/lib/backend";

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

interface Props {
  communityPlaceId?: string | null;
}

/**
 * WO-051 — Meetup detail location section for Meetups hosted at a verified
 * Community Place. Public place fields only; no verification internals.
 */
export function MeetupPlaceSection({ communityPlaceId }: Props) {
  const navigate = useNavigate();
  const enabled = isUuid(communityPlaceId);

  const { data: place } = useQuery({
    queryKey: ["meetup-place", communityPlaceId],
    enabled,
    queryFn: () => fetchCommunityPlaceById(communityPlaceId!),
  });

  if (!enabled || !place) return null;

  const directionsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${place.name} ${place.address}`,
  )}`;

  return (
    <section
      aria-labelledby="meetup-place-heading"
      className="rounded-2xl border border-border bg-card p-4 min-w-0"
    >
      <h2
        id="meetup-place-heading"
        className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted"
      >
        Community Place
      </h2>
      <p className="mt-1.5 font-semibold text-charcoal [overflow-wrap:anywhere]">
        {place.name}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {place.veggieClassification === "fully_vegan" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-soft-green text-primary">
            <Leaf className="w-2.5 h-2.5" aria-hidden />
            100% Vegan
          </span>
        )}
        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-charcoal">
          {CATEGORY_LABEL[place.category] ?? "Venue"}
        </span>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-sm text-charcoal-muted min-w-0">
        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        <span className="[overflow-wrap:anywhere]">
          {[place.neighborhood, place.address].filter(Boolean).join(" · ")}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => navigate(`/place/${place.id}`)}
          aria-label={`View Community Place ${place.name}`}
          className="h-10 px-4 rounded-xl border border-border bg-card text-sm font-semibold text-charcoal"
        >
          View Place
        </button>
        <a
          href={directionsHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Get directions to ${place.name}`}
          className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Navigation className="w-4 h-4" aria-hidden />
          Get Directions
        </a>
      </div>
      <p className="mt-3 text-[11px] text-charcoal-muted">
        This Meetup is hosted by a VeggieMeet member. The venue may not be affiliated
        with VeggieMeet.
      </p>
    </section>
  );
}
