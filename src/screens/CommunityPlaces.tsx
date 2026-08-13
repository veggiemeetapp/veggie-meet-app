import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Leaf, MapPin, Utensils } from "lucide-react";
import { AppHeader, Card, BackButton } from "@/components/app";
import { useLocationContext } from "@/hooks/useLocation";
import { fetchPublishedCommunityPlaces } from "@/lib/backend";
import { formatDistanceMeters, locationFallbackLabel } from "@/lib/distance";
import { logAnalyticsEvent } from "@/lib/analytics";
import type { CommunityPlace, CommunityPlaceCategory } from "@/types";

const categoryLabel: Record<CommunityPlaceCategory, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

type Filter = "all" | "restaurant" | "cafe";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "restaurant", label: "Restaurants" },
  { id: "cafe", label: "Cafés" },
];

export default function CommunityPlaces() {
  const navigate = useNavigate();
  const location = useLocationContext();
  const selectedCity = location.data?.selected_city ?? null;
  const cityId = selectedCity?.id ?? null;
  const cityLabel = selectedCity?.name ?? null;

  const [filter, setFilter] = useState<Filter>("all");
  // Current inclusion policy only permits fully vegan places, so the
  // classification filter is on by default.
  const [veganOnly, setVeganOnly] = useState(true);

  useEffect(() => {
    logAnalyticsEvent("community_places_opened", {
      source: document.referrer.includes("/community") ? "community_home" : "direct",
    });
  }, []);

  const placesQuery = useQuery<CommunityPlace[]>({
    queryKey: ["community-places-list", cityId],
    enabled: !location.isPending,
    queryFn: () => fetchPublishedCommunityPlaces(cityId),
    staleTime: 60_000,
  });

  // WO-061A: no client-side coordinate maths on Community Places.


  const all = placesQuery.data ?? [];

  const available = useMemo(() => {
    const set = new Set(all.map((p) => p.category));
    return set;
  }, [all]);

  const visible = useMemo(() => {
    const list = all.filter((p) => {
      if (veganOnly && p.veggieClassification !== "fully_vegan") return false;
      if (filter !== "all" && p.category !== filter) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      // WO-061A: distance is computed server-side; coordinates never reach the client.
      const da = a.distanceMeters ?? null;
      const db = b.distanceMeters ?? null;
      if (da != null && db != null && da !== db) return da - db;
      if (da != null && db == null) return -1;
      if (da == null && db != null) return 1;
      // Stable fallback: selected city first, then district, then name.
      const ca = a.cityId === cityId ? 0 : 1;
      const cb = b.cityId === cityId ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const na = (a.neighborhood ?? "").localeCompare(b.neighborhood ?? "");
      if (na !== 0) return na;
      return a.name.localeCompare(b.name);
    });
  }, [all, filter, veganOnly, cityId]);


  function changeFilter(next: Filter, nextVegan = veganOnly) {
    setFilter(next);
    setVeganOnly(nextVegan);
    logAnalyticsEvent("community_places_filter_changed", {
      category: next,
      vegan_classification: nextVegan ? "fully_vegan" : "any",
    });
  }

  return (
    <>
      <AppHeader
        left={
          <BackButton fallback="/community" />
        }
        title="Community Places"
        subtitle={cityLabel ? `Exploring ${cityLabel}` : undefined}
      />

      <div className="px-5 pt-4 pb-24 animate-fade-in">
        <p className="text-sm text-charcoal-muted">
          Discover 100% vegan places where the community can eat, meet, and connect.
        </p>

        {/* Filters */}
        <div
          role="group"
          aria-label="Filter Community Places"
          className="mt-4 flex flex-wrap gap-2"
        >
          {FILTERS.map((f) => {
            const disabled = f.id !== "all" && !available.has(f.id);
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => changeFilter(f.id)}
                className={[
                  "h-9 px-4 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-charcoal border-border/70",
                  disabled ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {f.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={veganOnly}
            onClick={() => changeFilter(filter, !veganOnly)}
            className={[
              "h-9 px-4 rounded-full text-sm font-medium border inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              veganOnly
                ? "bg-soft-green text-primary border-primary/40"
                : "bg-card text-charcoal border-border/70",
            ].join(" ")}
          >
            <Leaf className="w-3.5 h-3.5" aria-hidden />
            100% Vegan
          </button>
        </div>

        {/* Results */}
        {placesQuery.isPending ? (
          <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 rounded-card bg-muted animate-pulse" />
            ))}
          </div>

        ) : all.length === 0 ? (
          <EmptyBlock
            title="No Community Places here yet"
            body="We’re carefully verifying 100% vegan places before adding them to VeggieMeet."
          />
        ) : visible.length === 0 ? (
          <EmptyBlock
            title="No places match this filter"
            body="Try another category to see more Community Places."
            action={
              <button
                type="button"
                onClick={() => changeFilter("all", true)}
                className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Reset filters
              </button>
            }
          />
        ) : (
          <ul className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
            {visible.map((place, i) => (
              <li key={place.id} className="min-w-0">

                <PlaceListCard
                  place={place}
                  position={i}
                  cityLabel={cityLabel}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Community suggestion entry point — intentionally placed below the
            published results so it never competes with discovery. */}
        <section
          aria-labelledby="suggest-place-heading"
          className="mt-8 rounded-card border border-border/70 bg-card p-5"
        >
          <h2 id="suggest-place-heading" className="text-base font-semibold text-charcoal">
            Know a vegan place?
          </h2>
          <p className="mt-1 text-sm text-charcoal-muted">
            Suggest a 100% vegan place for the VeggieMeet community.
          </p>
          <Link
            to="/community/places/suggest"
            onClick={() =>
              logAnalyticsEvent("community_place_suggestion_started", {
                source: "community_places_list",
              })
            }
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Suggest a Place
          </Link>
        </section>
      </div>

    </>
  );
}

function EmptyBlock({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-6 rounded-card border border-dashed border-border/70 px-5 py-10 text-center">
      <h2 className="text-base font-semibold text-charcoal">{title}</h2>
      <p className="mt-1 text-sm text-charcoal-muted max-w-sm mx-auto">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function PlaceListCard({
  place,
  position,
  cityLabel,
}: {
  place: CommunityPlace;
  position: number;
  cityCoords?: { latitude: number; longitude: number } | null;
  cityLabel: string | null;
}) {
  // WO-061A: server-provided coarse distance only.
  const distance = formatDistanceMeters(place.distanceMeters ?? null);

  const area = locationFallbackLabel({
    neighborhood: place.neighborhood,
    cityName: place.cityName ?? cityLabel,
  });
  const isVegan = place.veggieClassification === "fully_vegan";

  return (
    <Link
      to={`/place/${place.id}`}
      aria-label={`${place.name}, ${categoryLabel[place.category]}${area ? `, ${area}` : ""}${
        distance ? `, ${distance}` : ""
      }${isVegan ? ", 100% Vegan" : ""}`}
      onClick={() =>
        logAnalyticsEvent("community_place_card_opened", {
          place_id: place.id,
          source: "community_places_list",
          position,
        })
      }
      className="block h-full rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Card padding="none" interactive className="h-full overflow-hidden flex flex-col">
        <div className="h-32 shrink-0">
          {/* WO-101: owner-managed cover photo; neutral placeholder otherwise. */}
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-soft-green flex items-center justify-center">
              <Utensils className="w-7 h-7 text-primary/70" aria-hidden />
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <h2 className="font-semibold text-charcoal text-sm leading-snug line-clamp-2 break-words min-h-[2.25rem]">
            {place.name}
          </h2>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-charcoal-muted">
            <span className="min-w-0 truncate">{categoryLabel[place.category]}</span>
            {(distance || area) && (
              <span
                className={`flex items-center gap-1 ${
                  distance ? "shrink-0 whitespace-nowrap" : "min-w-0"
                }`}
              >
                <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                <span className={distance ? undefined : "truncate"}>{distance ?? area}</span>
              </span>

            )}
          </div>
          {distance && area && (
            <div className="mt-1 text-[11px] text-charcoal-muted truncate">{area}</div>
          )}

          {isVegan && (
            <span className="mt-3 self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-soft-green text-primary">
              <Leaf className="w-3 h-3" aria-hidden />
              100% Vegan
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
