import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {

  ArrowLeft,
  MapPin,
  Leaf,
  Navigation,
  Wifi,
  Plug,
  Trees,
  PawPrint,
  Accessibility,
  Car,
  Users,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import { logAnalyticsEvent } from "@/lib/analytics";
import { Card, PrimaryButton, SecondaryButton, MeetupCard } from "@/components/app";
import { communityPlaces } from "@/lib/mock-data";
import { fetchUpcomingMeetupsAtPlace, fetchCommunityPlaceById } from "@/lib/backend";
import { PlaceCheckInSheet } from "@/components/place/PlaceCheckInSheet";
import { fetchPlaceCheckInState } from "@/lib/placeVisits";
import { placeStatusBanner } from "@/lib/placeMaintenance";
import { useAuth } from "@/hooks/useAuth";


import { meetups as mockMeetups } from "@/lib/mock-data";

type DietaryBadge = "100% Vegan" | "Vegetarian Friendly" | "Vegan Options";

interface PlaceExtras {
  district: string;
  dietary: DietaryBadge;
  about: string;
  highlights: string[];
  amenities: Array<keyof typeof AMENITY_ICONS>;
  activity: string[];
  photos: string[];
  lat?: number;
  lng?: number;
}

const AMENITY_ICONS = {
  "Wi-Fi": Wifi,
  "Power outlets": Plug,
  "Outdoor seating": Trees,
  "Pet friendly": PawPrint,
  "Wheelchair accessible": Accessibility,
  Parking: Car,
} as const;

const PLACE_EXTRAS: Record<string, PlaceExtras> = {
  p_kashew: {
    district: "District 1, Ho Chi Minh City",
    dietary: "100% Vegan",
    about:
      "A calm, sunlit café built around a long communal table. Veggies love it for slow oat lattes, warm cashew pastries, and the kind of quiet that makes it easy to start a conversation with someone new.",
    highlights: [
      "Weekly coffee meetups",
      "Great for first meetups",
      "Quiet weekday mornings",
      "Popular coworking spot",
    ],
    amenities: ["Wi-Fi", "Power outlets", "Outdoor seating", "Wheelchair accessible"],
    activity: [
      "Recently visited by Veggies",
      "Frequently hosts Meetups",
      "Popular with the community",
    ],
    photos: [
      "https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=800&q=80",
      "https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=800&q=80",
      "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&q=80",
      "https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=800&q=80",
    ],
  },
  p_hum: {
    district: "District 3, Ho Chi Minh City",
    dietary: "100% Vegan",
    about:
      "A garden-set restaurant serving seasonal plant-based Vietnamese cooking. Big shared tables and a leafy courtyard make it a natural home for dinner clubs and celebration meetups.",
    highlights: [
      "Popular for dinner meetups",
      "Great for groups",
      "Garden seating",
      "Warm, welcoming staff",
    ],
    amenities: ["Outdoor seating", "Wheelchair accessible", "Parking", "Pet friendly"],
    activity: [
      "Frequently hosts Meetups",
      "Recently visited by Veggies",
    ],
    photos: [
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80",
      "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=800&q=80",
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80",
      "https://images.unsplash.com/photo-1481931098730-318b6f776db0?w=800&q=80",
    ],
  },
  p_running_bean: {
    district: "District 1, Ho Chi Minh City",
    dietary: "Vegan Options",
    about:
      "A cozy neighborhood café known for late hours and easy hangs. Veggies drop in for board game nights, casual catch-ups, and a reliable oat flat white.",
    highlights: [
      "Open late",
      "Board game friendly",
      "Casual atmosphere",
      "Good for small groups",
    ],
    amenities: ["Wi-Fi", "Power outlets", "Outdoor seating"],
    activity: [
      "Popular with the community",
      "Recently visited by Veggies",
    ],
    photos: [
      "https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=800&q=80",
      "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=800&q=80",
      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&q=80",
    ],
  },
};

const DEFAULT_EXTRAS: PlaceExtras = {
  district: "",
  dietary: "Vegan Options",
  about: "A community-loved gathering spot.",
  highlights: ["Popular with the community"],
  amenities: ["Wi-Fi"],
  activity: ["Recently visited by Veggies"],
  photos: [],
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian Friendly",
  vegan_options: "Vegan Options",
  not_food: "Community Space",
};

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

function placeCategoryLabel(category: string) {
  return CATEGORY_LABEL[category] ?? "Venue";
}



export default function CommunityPlaceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const mockPlace = useMemo(() => communityPlaces.find((p) => p.id === id), [id]);
  const extras = PLACE_EXTRAS[id] ?? DEFAULT_EXTRAS;

  const { data: dbPlace = null } = useQuery({
    queryKey: ["community-place", id],
    enabled: !!id && !mockPlace,
    queryFn: () => fetchCommunityPlaceById(id),
  });

  const place = mockPlace ?? dbPlace;
  const isVerifiedPlace = !mockPlace && !!dbPlace;

  const { data: upcomingHere = [] } = useQuery({
    queryKey: ["place-upcoming", id],
    enabled: !!place,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const backendHere = await fetchUpcomingMeetupsAtPlace(id, today).catch(() => []);
      if (backendHere.length > 0) return backendHere;
      if (isVerifiedPlace) return [];
      // Fallback so the section is always meaningful in demo mode.
      return mockMeetups.filter((m) => m.communityPlaceId === id);
    },
  });

  const { profile } = useAuth();
  const [checkInOpen, setCheckInOpen] = useState(false);

  const { data: checkInState } = useQuery({
    queryKey: ["place-checkin-state", id],
    enabled: !!id && isVerifiedPlace && !!profile?.id,
    queryFn: () => fetchPlaceCheckInState(id),
  });
  const isCheckedIn = !!checkInState?.checkedIn;



  if (!place) {
    return (
      <div className="flex flex-col min-h-dvh">
        <div className="safe-top flex items-center gap-2 px-4 pt-3 pb-2">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-charcoal">Community Place</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">This place isn't available.</p>
          <button onClick={() => navigate("/community")} className="mt-2 text-sm font-semibold text-primary">
            Back to Community
          </button>
        </div>
      </div>
    );
  }

  const directionsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${place.name} ${place.address}`,
  )}`;

  const dietaryLabel = isVerifiedPlace
    ? CLASSIFICATION_LABEL[place.veggieClassification ?? ""] ?? null
    : extras.dietary;
  const showCover = place.hasCoverImage !== false;
  // WO-053: owner-maintained status. Non-operational places stay readable but
  // lose hosting and check-in; the server enforces both independently.
  const maintenanceStatus = isVerifiedPlace ? place.maintenanceStatus ?? "operational" : "operational";
  const isOperational = maintenanceStatus === "operational";
  const statusBanner = placeStatusBanner(maintenanceStatus);

  return (
    <div className="flex flex-col min-h-dvh pb-40">
      {/* Hero */}
      <div className="relative h-64">
        {showCover ? (
          <img src={place.coverImageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-soft-green flex items-center justify-center">
            <Leaf className="w-12 h-12 text-primary/60" aria-hidden />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/50 via-transparent to-background" />
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="absolute top-4 left-4 w-10 h-10 rounded-full flex items-center justify-center bg-background/90 backdrop-blur text-charcoal shadow-sm"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Title block */}
      <div className="px-5 -mt-6 relative">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {dietaryLabel && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-soft-green text-primary">
                <Leaf className="w-3 h-3" />
                {dietaryLabel}
              </span>
            )}
            {isVerifiedPlace && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-muted text-charcoal">
                {placeCategoryLabel(place.category)}
              </span>
            )}
          </div>
          <h1 className="text-[26px] font-semibold text-charcoal leading-tight tracking-tight">
            {place.name}
          </h1>
          <div className="flex items-center gap-1.5 text-sm text-charcoal-muted">
            <MapPin className="w-4 h-4 shrink-0" />
            <span>{isVerifiedPlace ? place.address : extras.district || place.address}</span>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className="px-5 mt-4">
          <div
            role="status"
            className={`rounded-2xl border p-3.5 min-w-0 ${
              statusBanner.tone === "closed"
                ? "border-destructive/40 bg-destructive/5"
                : "border-amber-500/40 bg-amber-500/10"
            }`}
          >
            <p className="text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">
              {statusBanner.title}
            </p>
            {place.statusNote && (
              <p className="mt-1 text-[13px] leading-relaxed text-charcoal-muted line-clamp-4 [overflow-wrap:anywhere]">
                {place.statusNote}
              </p>
            )}
            <p className="mt-1 text-xs text-charcoal-muted">
              Hosting and check-ins are paused here for now.
            </p>
          </div>
        </div>
      )}



      {isVerifiedPlace && (
        <>
          <SectionTitle>About</SectionTitle>
          <p className="px-5 text-[15px] leading-relaxed text-charcoal-muted break-words">
            {place.description}
          </p>

          {place.veggieReason && (
            <>
              <SectionTitle>Why Veggies Love It</SectionTitle>
              <p className="px-5 text-[15px] leading-relaxed text-charcoal-muted break-words">
                {place.veggieReason}
              </p>
            </>
          )}

          <SectionTitle>Links</SectionTitle>
          <div className="px-5 flex flex-col gap-2">
            {place.websiteUrl && (
              <a
                href={place.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-primary break-all"
              >
                Official website
              </a>
            )}
            {place.googleMapsUrl && (
              <a
                href={place.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-primary break-all"
              >
                View on Google Maps
              </a>
            )}
          </div>
        </>
      )}


      {/* Community Highlights (demo content only) */}
      {!isVerifiedPlace && (
        <>
          <SectionTitle>Community Highlights</SectionTitle>
          <div className="px-5">
            <Card className="space-y-2.5">
              {extras.highlights.map((h) => (
                <div key={h} className="flex items-start gap-2.5">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span className="text-sm text-charcoal leading-relaxed">{h}</span>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}


      {/* Upcoming Here */}
      <SectionTitle>Upcoming Here</SectionTitle>
      <div className="px-5">
        {upcomingHere.length > 0 ? (
          <div className="space-y-3">
            {upcomingHere.slice(0, 3).map((m) => (
              <MeetupCard key={m.id} meetup={m} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-charcoal-muted">
            No Meetups scheduled here yet. Be the first to host one.
          </p>
        )}
        {isVerifiedPlace && (
          <PrimaryButton
            fullWidth
            className="mt-3"
            onClick={() => {
              logAnalyticsEvent("host_from_place_tapped", { place_id: place.id });
              navigate(`/host?community_place=${place.id}`);
            }}
          >
            Host a Meetup Here
          </PrimaryButton>
        )}
      </div>

      {/* Demo-only enrichment sections */}
      {!isVerifiedPlace && (
        <>
          <SectionTitle>Community Activity</SectionTitle>
          <div className="px-5">
            <Card className="space-y-3">
              {extras.activity.map((a, i) => {
                const Icon = i === 0 ? Users : i === 1 ? CalendarDays : Sparkles;
                return (
                  <div key={a} className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-soft-green flex items-center justify-center text-primary shrink-0">
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-sm text-charcoal">{a}</span>
                  </div>
                );
              })}
            </Card>
          </div>

          <SectionTitle>About</SectionTitle>
          <p className="px-5 text-[15px] leading-relaxed text-charcoal-muted">
            {extras.about}
          </p>

          <SectionTitle>Amenities</SectionTitle>
          <div className="px-5 flex flex-wrap gap-2">
            {extras.amenities.map((label) => {
              const Icon = AMENITY_ICONS[label];
              return (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-charcoal text-xs font-medium"
                >
                  <Icon className="w-3.5 h-3.5 text-charcoal-muted" />
                  {label}
                </span>
              );
            })}
          </div>

          {extras.photos.length > 0 && (
            <>
              <SectionTitle>Photos</SectionTitle>
              <div
                className="flex gap-3 px-5 overflow-x-auto scrollbar-none pb-2"
                style={{ scrollSnapType: "x mandatory" }}
              >
                {extras.photos.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    loading="lazy"
                    className="h-40 w-56 rounded-2xl object-cover shrink-0 bg-muted"
                    style={{ scrollSnapAlign: "start" }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}


      {/* Bottom action */}
      <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-[var(--phone-max-width)] px-5 pt-4 pb-3 bg-gradient-to-t from-background via-background to-background/0" style={{ bottom: "var(--nav-height)" }}>
        <div className="flex gap-2">
          {/* WO-048: one check-in system only. Verified Community Places open the
              location-verified sheet; there is no alternate QR/legacy path. */}
          {isVerifiedPlace && (
            <SecondaryButton
              className="flex-1 min-w-0 px-4 text-[15px]"
              onClick={() => setCheckInOpen(true)}
            >
              <span className="truncate">{isCheckedIn ? "Checked In" : "Check In"}</span>
            </SecondaryButton>
          )}
          <PrimaryButton
            className="flex-1 min-w-0 px-4 text-[15px]"
            onClick={() => window.open(directionsHref, "_blank", "noopener,noreferrer")}
          >
            <Navigation className="w-4 h-4 mr-1.5 shrink-0" />
            <span className="truncate">Get Directions</span>
          </PrimaryButton>
        </div>
      </div>

      {isVerifiedPlace && (
        <PlaceCheckInSheet
          open={checkInOpen}
          onOpenChange={setCheckInOpen}
          placeId={place.id}
          placeName={place.name}
          alreadyCheckedIn={isCheckedIn}
          directionsHref={directionsHref}
          onCheckedIn={() => undefined}
          onViewImpact={() =>
            navigate("/you/places-supported?from=check_in_success")
          }
        />
      )}
    </div>

  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-5 mt-8 mb-3 text-lg font-semibold text-charcoal tracking-tight">
      {children}
    </h2>
  );
}

