import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Leaf, MapPin, Navigation } from "lucide-react";
import {
  fetchMeetupPlaceContext,
  snapshotDirectionsHref,
} from "@/lib/meetupPlaceContext";
import { logAnalyticsEvent } from "@/lib/analytics";

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

interface Props {
  meetupId?: string | null;
}

/**
 * WO-051 / WO-062 — Meetup detail Community Place card.
 *
 * The address shown always comes from the Meetup snapshot (historical event
 * data). Current Community Place state is surfaced only as a safe availability
 * label; it never rewrites the snapshot.
 */
export function MeetupPlaceSection({ meetupId }: Props) {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["meetup-place-context", meetupId],
    enabled: !!meetupId,
    queryFn: () => fetchMeetupPlaceContext(meetupId!),
  });

  const place = data?.place ?? null;
  const state = place?.locationIntegrityState;

  useEffect(() => {
    if (state) {
      logAnalyticsEvent("meetup_community_place_viewed", { integrity_state: state });
    }
  }, [state]);

  if (!data?.linked || !place) return null;

  const directionsHref = place.directionsAllowed
    ? snapshotDirectionsHref(data.snapshot)
    : null;
  const warning = place.memberMessage;
  const snapshotLine = [data.snapshot?.neighborhood, data.snapshot?.address]
    .filter(Boolean)
    .join(" · ");

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
        {data.snapshot?.locationName || place.publicName}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {place.isFullyVegan && place.isPubliclyAvailable && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-soft-green text-primary">
            <Leaf className="w-2.5 h-2.5" aria-hidden />
            100% Vegan
          </span>
        )}
        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-charcoal">
          {CATEGORY_LABEL[place.category] ?? "Venue"}
        </span>
        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-charcoal">
          {place.statusLabel}
        </span>
      </div>

      {snapshotLine && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-charcoal-muted min-w-0">
          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
          <span className="[overflow-wrap:anywhere]">{snapshotLine}</span>
        </p>
      )}

      {warning && !data.isHistorical && (
        <p
          role="status"
          className="mt-3 flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-xs text-charcoal"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
          <span className="[overflow-wrap:anywhere]">{warning}</span>
        </p>
      )}

      <p className="mt-3 text-xs text-charcoal-muted">
        {place.memberHasSupportedPlace
          ? "You have supported this Community Place before."
          : "You have not supported this Community Place yet."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {place.publicPlaceRoute && (
          <button
            type="button"
            onClick={() => {
              logAnalyticsEvent("meetup_community_place_opened", {
                integrity_state: place.locationIntegrityState,
              });
              navigate(place.publicPlaceRoute!);
            }}
            aria-label={`View Community Place ${place.publicName}`}
            className="h-10 px-4 rounded-xl border border-border bg-card text-sm font-semibold text-charcoal"
          >
            View Place
          </button>
        )}
        {directionsHref ? (
          <a
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Get directions to the Meetup location, ${
              data.snapshot?.locationName ?? place.publicName
            }`}
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Navigation className="w-4 h-4" aria-hidden />
            Get Directions
          </a>
        ) : (
          <span className="h-10 px-4 rounded-xl border border-border bg-muted text-sm font-semibold text-charcoal-muted inline-flex items-center">
            Directions unavailable — location is being reviewed
          </span>
        )}
      </div>

      <p className="mt-3 text-[11px] text-charcoal-muted">
        This Meetup is hosted by a VeggieMeet member. The venue may not be affiliated
        with VeggieMeet.
      </p>
    </section>
  );
}
