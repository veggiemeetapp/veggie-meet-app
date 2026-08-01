import { useMemo } from "react";
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
import { TODAY_ISO } from "@/lib/mock-data";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { formatDistanceBetween, locationFallbackLabel } from "@/lib/distance";
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
  const location = useLocationContext();
  const selectedCity = location.data?.selected_city ?? null;
  const cityId = selectedCity?.id ?? null;

  const meetupsQuery = useQuery<Meetup[]>({
    queryKey: ["community-feed", "meetups", cityId],
    enabled: !!cityId,
    queryFn: () => fetchUpcomingMeetupsByCity(cityId!, TODAY_ISO),
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

  const cityCoords = useMemo(
    () =>
      selectedCity && selectedCity.latitude != null && selectedCity.longitude != null
        ? { latitude: selectedCity.latitude, longitude: selectedCity.longitude }
        : null,
    [selectedCity],
  );

  return (
    <>
      <AppHeader
        title={
          <span>
            {hello} {name}
          </span>
        }
        subtitle={
          cityLabel
            ? `Exploring ${cityLabel}. Change city anytime.`
            : "Pick a city to see who's around."
        }
        right={
          <div className="flex items-center gap-1">
            <CitySelector />
            <Link
              to="/search"
              aria-label="Search Veggies, Meetups, and Places"
              className="w-9 h-9 rounded-full inline-flex items-center justify-center hover:bg-muted/60 text-charcoal"
            >
              <SearchIcon className="w-5 h-5" aria-hidden />
            </Link>
            <NotificationsBell />
          </div>
        }
      />

      {!cityId ? (
        <NoCityState onChoose={() => document.querySelector<HTMLButtonElement>('[aria-label*="city"]')?.click()} />
      ) : (
        <div className="pb-12 animate-fade-in">
          {/* Meetups Near You */}
          <SectionHeader
            icon={Sprout}
            title="Meetups Near You"
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
              message={`No upcoming Meetups in ${cityLabel} yet. Check back soon or host one.`}
            />
          ) : (
            <HScroll>
              {meetupsQuery.data!.map((m) => (
                <MeetupNearbyCard key={m.id} meetup={m} cityCoords={cityCoords} cityLabel={cityLabel} />
              ))}
            </HScroll>
          )}

          {/* Veggies Nearby */}
          <SectionHeader
            icon={Users}
            title="Veggies Nearby"
            ctaLabel="Discover"
            ctaTo="/network?tab=meet-next"
          />
          {veggiesQuery.isPending ? (
            <HScrollSkeleton />
          ) : (veggiesQuery.data ?? []).length === 0 ? (
            <EmptyRow message={`No Veggies with ${cityLabel} as their Home City yet.`} />
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
            title="Community Places"
            ctaLabel="Explore"
            ctaTo="/community/places"
          />
          {placesQuery.isPending ? (
            <HScrollSkeleton />
          ) : (placesQuery.data ?? []).length === 0 ? (
            <EmptyRow message={`No Community Places listed in ${cityLabel} yet.`} />
          ) : (
            <HScroll>
              {placesQuery.data!.map((p) => (
                <PlaceNearbyCard key={p.id} place={p} cityCoords={cityCoords} cityLabel={cityLabel} />
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
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-charcoal-muted/70">
            Coming soon
          </span>
        ) : ctaDisabled ? (
          <span
            aria-disabled="true"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-charcoal-muted/70"
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
      className="flex gap-3 px-5 overflow-x-auto scrollbar-none pb-2 -mx-1"
      style={{ scrollSnapType: "x mandatory" }}
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
    <div className="flex gap-3 px-5 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-64 h-52 rounded-2xl bg-muted animate-pulse shrink-0" />
      ))}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="mx-5 rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-charcoal-muted">
      {message}
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
  cityCoords,
  cityLabel,
}: {
  place: CommunityPlace;
  cityCoords: { latitude: number; longitude: number } | null;
  cityLabel: string | null;
}) {
  const distance =
    cityCoords &&
    formatDistanceBetween(cityCoords, {
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
    });
  const label =
    distance ??
    locationFallbackLabel({ neighborhood: place.neighborhood, cityName: place.cityName ?? cityLabel });

  return (
    <Link to={`/place/${place.id}`} className="block">
      <Card padding="none" interactive className="w-56 shrink-0 overflow-hidden">
        <div className="h-32">
          {place.hasCoverImage === false ? (
            <div className="w-full h-full bg-soft-green flex items-center justify-center">
              <Utensils className="w-7 h-7 text-primary/70" aria-hidden />
            </div>
          ) : (
            <img
              src={place.coverImageUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )}
        </div>

        <div className="p-3">
          <h3 className="font-semibold text-charcoal text-sm leading-snug line-clamp-2 break-words min-h-[2.25rem]">
            {place.name}
          </h3>
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
