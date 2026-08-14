import { useEffect, useMemo } from "react";
import { logAnalyticsEvent } from "@/lib/analytics";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Calendar, MapPin, Search as SearchIcon, Sprout, Users, Utensils } from "lucide-react";
import { AppHeader, Card, NotificationsBell, UserAvatar } from "@/components/app";
import { CitySelector, NoCityState } from "@/components/location/CitySelector";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/hooks/useLocation";
import {
  fetchCommunityPlacesByCity,
  fetchNearbyVeggiesByCity,
  fetchUpcomingMeetupsByCity,
  type NearbyVeggie,
} from "@/lib/backend";
import { todayISO } from "@/lib/todayDate";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { formatDistanceBetween, formatDistanceMeters, locationFallbackLabel } from "@/lib/distance";
import type { CommunityPlace, Meetup } from "@/types";

function greeting(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function firstName(name?: string | null) {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0];
}

const placeCategoryLabel: Record<CommunityPlace["category"], string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

export default function Community() {
  const { profile } = useAuth();

  // WO-084A: surface view event (mount-only, deduped by the logger).
  useEffect(() => {
    logAnalyticsEvent("community_home_opened", {});
  }, []);
  const location = useLocationContext();
  const selectedCity = location.data?.selected_city ?? null;
  const cityId = selectedCity?.id ?? null;

  const meetupsQuery = useQuery<Meetup[]>({
    queryKey: ["community-feed", "meetups", cityId],
    enabled: !!cityId,
    queryFn: () => fetchUpcomingMeetupsByCity(cityId!, todayISO()),
    staleTime: 60_000,
  });

  const placesQuery = useQuery<CommunityPlace[]>({
    queryKey: ["community-feed", "places", cityId],
    enabled: !!cityId,
    queryFn: () => fetchCommunityPlacesByCity(cityId!),
    staleTime: 60_000,
  });

  const veggiesQuery = useQuery<NearbyVeggie[]>({
    queryKey: ["community-feed", "veggies", cityId, profile?.id],
    enabled: !!cityId && !!profile?.id,
    queryFn: () => fetchNearbyVeggiesByCity(cityId!, profile!.id),
    staleTime: 60_000,
  });

  const name = firstName(profile?.display_name);
  const hello = greeting(new Date().getHours());
  const cityLabel = selectedCity?.name ?? null;
  // Titles are only rendered once a city is chosen; this keeps them safe anyway.
  const cityTitle = cityLabel ?? "your city";

  const cityCoords = useMemo(
    () =>
      selectedCity && selectedCity.latitude != null && selectedCity.longitude != null
        ? { latitude: selectedCity.latitude, longitude: selectedCity.longitude }
        : null,
    [selectedCity],
  );

  return (
    <>
      {/* DEF-092A-04: the city selector sat in the header's right cluster, so at
          390px and below the greeting truncated to "Good Aft…" and the subtitle
          to "Exploring Ho …". The city control now sits under the title, which
          is also the pattern Today already uses.
          DEF-092A-06: the search control was a 36px box; it now uses the shared
          44px IconButton like every other header control. */}
      <AppHeader
        title={
          <span>
            {hello} {name}
          </span>
        }
        subtitle={
          cityLabel
            ? `Exploring ${cityLabel}`
            : "Pick a city to see who's around."
        }

        right={
          <div className="flex items-center gap-1">
            <Link
              to="/search"
              aria-label="Search Veggies, Meetups, and Places"
              className="w-11 h-11 shrink-0 rounded-full inline-flex items-center justify-center hover:bg-muted text-charcoal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <SearchIcon className="w-5 h-5" aria-hidden />
            </Link>
            <NotificationsBell />
          </div>
        }
      />

      <div className="page-x pt-4">
        <CitySelector />
      </div>

      {!cityId ? (
        <NoCityState onChoose={() => document.querySelector<HTMLButtonElement>('[aria-label*="city"]')?.click()} />
      ) : (
        <div className="pb-12 animate-fade-in">

          {/* WO-096 DEF-096-05: "Near You"/"Nearby" implied device proximity,
              but every list here is ranked by the member's chosen city — the app
              never uses device location for discovery. Titles now say so. */}
          <SectionHeader
            icon={Sprout}
            title={`Meetups in ${cityTitle}`}
            ctaLabel="View all"
            ctaTo="/community/meetups"
            ctaComingSoon
          />
          {meetupsQuery.isPending ? (
            <HScrollSkeleton />
          ) : meetupsQuery.isError ? (
            <EmptyRow message="We couldn't load Meetups just now. Pull to retry." />
          ) : (meetupsQuery.data ?? []).length === 0 ? (
            <EmptyRow
              message={`VeggieMeet is just getting started in ${cityLabel}. You could host the first Meetup here.`}
              actionLabel="Host a Meetup"
              actionTo="/host"
            />

          ) : (
            <HScroll>
              {meetupsQuery.data!.map((m) => (
                <MeetupNearbyCard key={m.id} meetup={m} cityCoords={cityCoords} cityLabel={cityLabel} />
              ))}
            </HScroll>
          )}

          <SectionHeader
            icon={Users}
            title={`Veggies in ${cityTitle}`}
            ctaLabel="Discover"
            ctaTo="/network?tab=meet-next"
          />
          {veggiesQuery.isPending ? (
            <HScrollSkeleton />
          ) : (veggiesQuery.data ?? []).length === 0 ? (
            <EmptyRow
              message={`Veggies are still joining in ${cityLabel}. We’ll show them here as the community grows.`}
            />

          ) : (
            <HScroll>
              {veggiesQuery.data!.map((v) => (
                <VeggieNearbyCard key={v.id} veggie={v} />
              ))}
            </HScroll>
          )}

          {/* Community Places */}
          <SectionHeader
            icon={Utensils}
            title={`Community Places in ${cityTitle}`}
            ctaLabel="Explore"
            ctaTo="/community/places"
          />
          {placesQuery.isPending ? (
            <HScrollSkeleton />
          ) : (placesQuery.data ?? []).length === 0 ? (
            <EmptyRow
              message={`No verified vegan places in ${cityLabel} yet. Suggest one you love and we’ll verify it.`}
              actionLabel="Suggest a place"
              actionTo="/community/places/suggest"
            />

          ) : (
            <HScroll>
              {placesQuery.data!.map((p) => (
                <PlaceNearbyCard key={p.id} place={p} cityLabel={cityLabel} />
              ))}
            </HScroll>
          )}
        </div>
      )}
    </>
  );
}

/* ---------- Layout primitives ---------- */

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  ctaLabel,
  ctaTo,
  ctaDisabled,
  ctaComingSoon,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaTo?: string;
  ctaDisabled?: boolean;
  ctaComingSoon?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-5 mt-10 mb-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold text-charcoal tracking-tight flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-charcoal-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {ctaLabel && ctaTo && (
        ctaComingSoon ? (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-charcoal-muted">
            Coming soon
          </span>
        ) : ctaDisabled ? (
          <span
            aria-disabled="true"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-charcoal-muted"
          >
            {ctaLabel}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </span>
        ) : (
          <Link
            to={ctaTo}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-charcoal-muted hover:text-primary transition-colors rounded-full px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {ctaLabel}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        )
      )}
    </div>
  );
}

function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <div
      // DEF-092A-09: scroll snapping ignored the 20px gutter, so the rail landed
      // with its first card flush to the screen edge. scroll-padding keeps the
      // snap positions aligned with the page gutter.
      className="rail flex gap-3 page-x overflow-x-auto scrollbar-none pb-2"
      style={{ scrollSnapType: "x mandatory", scrollPaddingLeft: "var(--page-gutter)" }}
    >

      {Array.isArray(children)
        ? children.map((child, i) => (
            <div key={i} style={{ scrollSnapAlign: "start" }}>
              {child}
            </div>
          ))
        : children}
    </div>
  );
}

function HScrollSkeleton() {
  return (
    <div className="flex gap-3 px-5 overflow-hidden min-h-52">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-64 h-52 rounded-card bg-muted animate-pulse shrink-0" />
      ))}
    </div>
  );
}

function EmptyRow({
  message,
  actionLabel,
  actionTo,
}: {
  message: string;
  actionLabel?: string;
  actionTo?: string;
}) {
  // WO-086 DEF-086-08: the loading skeleton reserved 13rem while the resolved
  // empty state was ~5rem tall, so every section that came back empty yanked
  // the sections below it upward (measured CLS 0.06 on Community). Reserving
  // the same height in both states keeps the page visually stable.
  return (
    <div className="px-5 min-h-52 flex items-center">
      <div className="w-full rounded-card border border-dashed border-border/70 px-4 py-6 text-center">
        <p className="text-sm text-charcoal-muted copy">{message}</p>
        {/* WO-095 §5: at most one action per empty row. */}
        {actionLabel && actionTo && (
          <Link
            to={actionTo}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-soft-green px-4 text-sm font-semibold text-primary"
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}



/* ---------- Cards ---------- */

function locationLabelFor(meetup: Meetup, cityCoords: { latitude: number; longitude: number } | null, cityLabel: string | null) {
  const loc = meetup.location;
  if (!loc) return locationFallbackLabel({ cityName: cityLabel });
  const distance =
    cityCoords && formatDistanceBetween(cityCoords, { latitude: loc.latitude, longitude: loc.longitude });
  if (distance) return distance;
  return (
    locationFallbackLabel({ neighborhood: loc.neighborhood, cityName: loc.cityName ?? cityLabel }) ??
    "Location to be confirmed"
  );
}

function MeetupNearbyCard({
  meetup,
  cityCoords,
  cityLabel,
}: {
  meetup: Meetup;
  cityCoords: { latitude: number; longitude: number } | null;
  cityLabel: string | null;
}) {
  const label = locationLabelFor(meetup, cityCoords, cityLabel);
  return (
    <Link to={`/meetup/${meetup.id}`} className="block">
      <Card padding="none" interactive className="w-64 shrink-0 overflow-hidden">
        <div className="relative h-32">
          <img
            src={meetup.coverImageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-background/90 backdrop-blur text-charcoal uppercase tracking-wider">
            {meetup.category}
          </span>
        </div>
        <div className="p-3">
          <h3 className="font-semibold text-charcoal text-sm leading-tight line-clamp-1">
            {meetup.title}
          </h3>
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-charcoal-muted">
            <Calendar className="w-3 h-3 shrink-0" aria-hidden />
            <span className="truncate">
              {formatMeetupDate(meetup.date)} · {formatTime12h(meetup.startTime)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-charcoal-muted">
            <MapPin className="w-3 h-3 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary">
            <Users className="w-3 h-3" aria-hidden />
            {meetup.attendeeIds.length} / {meetup.capacity}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function VeggieNearbyCard({ veggie }: { veggie: NearbyVeggie }) {
  return (
    <Link to={`/veggie/${veggie.id}`}>
      <Card padding="md" interactive className="w-56 shrink-0">
        <div className="flex flex-col items-center text-center">
          <UserAvatar name={veggie.displayName} src={veggie.avatarUrl ?? undefined} size="lg" />
          <div className="mt-2 font-semibold text-charcoal text-sm truncate max-w-full">
            {veggie.displayName}
          </div>
          {veggie.cityName && (
            <div className="text-[11px] text-charcoal-muted flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden />
              <span className="truncate">{veggie.cityName}</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1 justify-center">
            {veggie.interests.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
          {veggie.isActiveHost && (
            <div className="mt-3 text-[11px] text-primary font-medium">Active Host</div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function PlaceNearbyCard({
  place,
  cityLabel,
}: {
  place: CommunityPlace;
  cityCoords?: { latitude: number; longitude: number } | null;
  cityLabel: string | null;
}) {
  // WO-061A: distance comes pre-computed from the server; no coordinates here.
  const distance = formatDistanceMeters(place.distanceMeters ?? null);
  const label =
    distance ??
    locationFallbackLabel({ neighborhood: place.neighborhood, cityName: place.cityName ?? cityLabel });


  // WO-105 DEF-105-01: this card read the legacy `cover_image_url` column, which
  // WO-101 retired, so real owner-managed covers never rendered here. It now
  // uses the same canonical signed-URL hook as every other place surface.
  const coverUrl = usePlaceCoverUrl(place.id);

  return (
    <Link to={`/place/${place.id}`} className="block">
      <Card padding="none" interactive className="w-56 shrink-0 overflow-hidden">
        <div className="h-32">
          <PlaceCoverImage coverUrl={coverUrl} />
        </div>

        <div className="p-3">
          <h2 className="font-semibold text-charcoal text-sm leading-snug line-clamp-2 break-words min-h-[2.25rem]">
            {place.name}
          </h2>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-charcoal-muted">
            <span className="shrink-0">{placeCategoryLabel[place.category]}</span>
            {label && (
              <span className="flex items-center gap-1 min-w-0">
                <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
