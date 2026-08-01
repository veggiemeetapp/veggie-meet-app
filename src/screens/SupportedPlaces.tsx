import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Leaf, MapPin, Store } from "lucide-react";
import { AppHeader, Card, PrimaryButton, SecondaryButton } from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  fetchMySupportedPlaces,
  formatActivityDate,
  SUPPORT_SOURCE_LABEL,
  type SupportedPlace,
} from "@/lib/supportedPlaces";

const categoryLabel: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

export default function SupportedPlaces() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [params] = useSearchParams();

  const query = useQuery({
    queryKey: ["me-supported-places", profile?.id],
    enabled: !!profile?.id,
    queryFn: fetchMySupportedPlaces,
    staleTime: 30_000,
  });

  useEffect(() => {
    const s = params.get("from");
    logAnalyticsEvent("supported_places_opened", {
      source:
        s === "community_impact" || s === "check_in_success" ? s : "direct",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const places = useMemo(() => query.data?.places ?? [], [query.data]);

  return (
    <>
      <AppHeader
        left={
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="w-9 h-9 -ml-1 rounded-full inline-flex items-center justify-center hover:bg-muted/60 text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </button>
        }
        title="Places You’ve Supported"
      />

      <div className="px-5 pt-4 pb-24 animate-fade-in">
        <p className="text-sm text-charcoal-muted">
          Your verified visits to 100% vegan Community Places.
        </p>

        {query.isPending ? (
          <div className="mt-5 space-y-3">
            <div className="h-28 rounded-2xl bg-muted animate-pulse" />
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
              {[0, 1].map((i) => (
                <div key={i} className="h-36 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          </div>
        ) : query.isError ? (
          <Card padding="lg" className="mt-6 text-center">
            <h2 className="text-base font-semibold text-charcoal">
              We couldn’t load your places
            </h2>
            <p className="mt-1 text-sm text-charcoal-muted">Try again in a moment.</p>
            <div className="mt-4 flex justify-center">
              <PrimaryButton size="sm" onClick={() => query.refetch()}>
                Try Again
              </PrimaryButton>
            </div>
          </Card>
        ) : (
          <>
            <Card padding="lg" className="mt-5">
              <div className="flex items-start gap-3">
                <div
                  aria-hidden
                  className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center shrink-0"
                >
                  <Leaf className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider font-semibold text-charcoal-muted">
                    Community Places Supported
                  </div>
                  <div
                    className="mt-0.5 text-3xl font-bold text-charcoal leading-none tabular-nums"
                    aria-label={`${query.data?.distinct_supported ?? 0} Community Places supported`}
                  >
                    {query.data?.distinct_supported ?? 0}
                  </div>
                  <p className="mt-1.5 text-sm text-charcoal-muted">
                    Each place counts once, even when you visit more than once.
                  </p>
                  <p className="mt-2 text-xs text-charcoal-muted">
                    Verified visits (check-ins):{" "}
                    <span className="font-semibold tabular-nums">
                      {query.data?.direct_visits_total ?? 0}
                    </span>
                  </p>
                </div>
              </div>
            </Card>

            {places.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center">
                <h2 className="text-base font-semibold text-charcoal">
                  No supported places yet
                </h2>
                <p className="mt-1 text-sm text-charcoal-muted max-w-sm mx-auto">
                  Check in when you visit a Community Place, or attend a meetup hosted
                  there.
                </p>
                <div className="mt-5 flex justify-center">
                  <Link
                    to="/community/places"
                    onClick={() =>
                      logAnalyticsEvent("supported_places_explore_clicked", {
                        source: "empty_state",
                      })
                    }
                    className="h-10 px-5 inline-flex items-center rounded-full bg-primary text-primary-foreground text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Explore Community Places
                  </Link>
                </div>
                <p className="mt-4 text-xs text-charcoal-muted">
                  Your exact location is never saved.
                </p>
              </div>
            ) : (
              <ul className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
                {places.map((place, i) => (
                  <li key={place.community_place_id} className="min-w-0">
                    <SupportedPlaceCard place={place} position={i} />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6">
              <SecondaryButton
                size="sm"
                fullWidth
                onClick={() => navigate("/impact")}
                aria-label="View all Community Impact"
              >
                View all Community Impact
                <ChevronRight className="w-4 h-4" />
              </SecondaryButton>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function SupportedPlaceCard({
  place,
  position,
}: {
  place: SupportedPlace;
  position: number;
}) {
  const sourceLabel = SUPPORT_SOURCE_LABEL[place.support_source];
  const date = formatActivityDate(place.last_activity_at);
  const area = place.neighborhood ?? null;
  const repeat = place.direct_visit_count > 1;

  return (
    <Link
      to={`/place/${place.community_place_id}`}
      onClick={() =>
        logAnalyticsEvent("supported_place_card_opened", {
          place_id: place.community_place_id,
          position,
          support_source: place.support_source,
        })
      }
      aria-label={`${place.name}, ${categoryLabel[place.category] ?? place.category}${
        area ? `, ${area}` : ""
      }, ${sourceLabel}${date ? `, latest activity ${date}` : ""}${
        repeat ? `, ${place.direct_visit_count} verified visits` : ""
      }${place.is_active ? "" : ", currently unavailable"}`}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Card interactive padding="none" className="overflow-hidden h-full">
        <div className="h-28 bg-soft-green flex items-center justify-center overflow-hidden">
          {place.has_cover_image && place.cover_image_url ? (
            <img
              src={place.cover_image_url}
              alt={place.name}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <Store className="w-8 h-8 text-primary" aria-hidden />
          )}
        </div>
        <div className="p-4 min-w-0">
          <h3 className="text-[15px] font-semibold text-charcoal leading-snug line-clamp-2">
            {place.name}
          </h3>
          <p className="mt-1 text-xs text-charcoal-muted flex items-center gap-1 min-w-0">
            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {categoryLabel[place.category] ?? place.category}
              {area ? ` · ${area}` : ""}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-soft-green text-primary text-[11px] font-medium px-2.5 py-1">
              {sourceLabel}
            </span>
            {repeat && (
              <span className="inline-flex items-center rounded-full bg-muted text-charcoal-muted text-[11px] font-medium px-2.5 py-1 whitespace-nowrap">
                {place.direct_visit_count} verified visits
              </span>
            )}
            {!place.is_active && (
              <span className="inline-flex items-center rounded-full bg-muted text-charcoal-muted text-[11px] font-medium px-2.5 py-1">
                Currently unavailable
              </span>
            )}
          </div>
          {date && (
            <p className="mt-2 text-xs text-charcoal-muted whitespace-nowrap">
              Visited {date}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}
