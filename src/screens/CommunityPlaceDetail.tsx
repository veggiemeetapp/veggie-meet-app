import { safeBack } from "@/lib/navigation";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin,
  Leaf,
  Navigation,
  ShieldCheck,
  CalendarDays,
  Users,
  Share2,
  ExternalLink,
  Globe,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { logAnalyticsEvent } from "@/lib/analytics";
import { Card, PrimaryButton, SecondaryButton, BackButton } from "@/components/app";
import { PlaceCheckInSheet } from "@/components/place/PlaceCheckInSheet";
import { PlacePhotoGallery } from "@/components/place/PlacePhotoGallery";
import { usePlaceCoverUrl } from "@/hooks/usePlacePhotos";
import { placeStatusBanner } from "@/lib/placeMaintenance";
import type { CommunityPlaceMaintenanceStatus } from "@/types";
import {
  fetchCommunityPlaceDetail,
  formatMeetupWhen,
  formatVisitDate,
  CLASSIFICATION_LABEL,
  PLACE_CATEGORY_LABEL,
  FRESHNESS_LABEL,
  type PlaceDetailMeetup,
} from "@/lib/placeDetail";

export default function CommunityPlaceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const source = search.get("from") ?? "direct";

  const [checkInOpen, setCheckInOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["place-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const detail = await fetchCommunityPlaceDetail(id);
      logAnalyticsEvent("community_place_detail_opened", { source });
      return detail;
    },
  });

  if (isLoading) {
    return (
      <PageFrame onBack={() => safeBack(navigate, "/community/places")}>
        <div className="px-5 py-10 space-y-3" role="status" aria-live="polite">
          <span className="sr-only">Loading this Community Place</span>
          <div className="h-40 rounded-card bg-muted animate-pulse" />
          <div className="h-5 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
        </div>
      </PageFrame>
    );
  }

  if (isError) {
    return (
      <PageFrame onBack={() => safeBack(navigate, "/community/places")}>
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 text-center gap-3" role="alert">
          <p className="text-charcoal font-medium">We couldn't load this place.</p>
          <SecondaryButton onClick={() => refetch()}>Try Again</SecondaryButton>
        </div>
      </PageFrame>
    );
  }

  const place = data?.found ? data.place : undefined;

  if (!place) {
    return (
      <PageFrame onBack={() => safeBack(navigate, "/community/places")}>
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 text-center gap-3">
          <p className="text-charcoal font-medium">This place isn't available.</p>
          <button
            onClick={() => navigate("/community/places")}
            className="mt-2 text-sm font-semibold text-primary"
          >
            Browse Community Places
          </button>
        </div>
      </PageFrame>
    );
  }

  const mySupport = data!.my_support!;
  const impact = data!.impact!;
  const meetups = data!.upcoming_meetups;
  const maintenanceStatus = place.maintenance_status as CommunityPlaceMaintenanceStatus;
  const statusBanner = placeStatusBanner(maintenanceStatus);
  const isOperational = maintenanceStatus === "operational";
  const canCheckIn = mySupport.check_in_available;
  const canHost = data!.can_host_here;

  const directionsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${place.name} ${place.address ?? ""}`,
  )}`;
  const dietaryLabel = CLASSIFICATION_LABEL[place.veggie_classification ?? ""] ?? null;

  async function onShare() {
    const url = `${window.location.origin}/place/${place!.id}`;
    const shareData = {
      title: place!.name,
      text: `${place!.name} — a verified VeggieMeet Community Place`,
      url,
    };
    try {
      // WO-093: capability detection, never UA sniffing. iOS Safari and Android
      // Chrome both expose Web Share; desktop and locked-down browsers fall
      // back to the clipboard.
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(shareData);
        logAnalyticsEvent("community_place_shared", { method: "web_share" });
        return;
      }
      await navigator.clipboard.writeText(url);
      logAnalyticsEvent("community_place_shared", { method: "copy_link" });
      setShareMessage("Link copied");
      window.setTimeout(() => setShareMessage(""), 2500);
    } catch (e) {
      // A dismissed share sheet is a normal outcome and must stay silent.
      // WO-093 DEF-093-06: a *failed* clipboard write (Safari denies it outside
      // a user gesture, and it is unavailable in some private modes) previously
      // also stayed silent, so Share looked broken. Give member-safe feedback
      // without surfacing the raw browser error.
      const name = (e as { name?: string } | null)?.name ?? "";
      if (name === "AbortError") return;
      setShareMessage("Couldn't share — copy the link from your address bar.");
      window.setTimeout(() => setShareMessage(""), 4000);
    }


  }

  return (
    <div className="flex flex-col min-h-dvh pb-40">
      {/* Hero */}
      <div className="relative h-56 sm:h-64">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-soft-green flex items-center justify-center">
            <Leaf className="w-12 h-12 text-primary/60" aria-hidden />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/50 via-transparent to-background" />
        {/* DEF-092A-08: the back control sat in the hero's normal flow, so it was
            pushed below the image and collided with the place title. It now sits
            pinned at the hero's top-left like every other hero surface. */}
        <div className="safe-top absolute top-0 left-0 z-10 p-1.5">
          <BackButton fallback="/community/places" className="ml-0" />
        </div>

      </div>

      <div className="px-5 -mt-6 relative space-y-2.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {dietaryLabel && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-soft-green text-primary">
              <Leaf className="w-3 h-3" aria-hidden />
              {dietaryLabel}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-muted text-charcoal">
            {PLACE_CATEGORY_LABEL[place.category] ?? "Venue"}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-muted text-charcoal-muted">
            {FRESHNESS_LABEL[place.verification_freshness]}
          </span>
        </div>
        <h1 className="text-[26px] font-semibold text-charcoal leading-tight tracking-tight [overflow-wrap:anywhere]">
          {place.name}
        </h1>
        <div className="flex items-start gap-1.5 text-sm text-charcoal-muted min-w-0">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span className="[overflow-wrap:anywhere]">
            {[place.neighborhood, place.address].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>

      {statusBanner && (
        <div className="px-5 mt-4">
          <div
            role="status"
            className={`rounded-card border p-3.5 min-w-0 ${
              statusBanner.tone === "closed"
                ? "border-destructive/40 bg-destructive/5"
                : "border-warning-border bg-warning-soft"
            }`}
          >
            <p className="text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">
              {statusBanner.title}
            </p>
            <p className="mt-1 text-xs text-charcoal-muted">
              Hosting and check-ins are paused here for now.
            </p>
          </div>
        </div>
      )}

      {/* Trust */}
      <SectionTitle>Verified by VeggieMeet</SectionTitle>
      <div className="px-5">
        <Card className="space-y-2.5 min-w-0">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-charcoal leading-relaxed">
              This place has been confirmed as a 100% vegan Community Place through
              VeggieMeet's verification process.
            </p>
          </div>
          <p className="text-xs text-charcoal-muted">
            {FRESHNESS_LABEL[place.verification_freshness]}
            {place.last_verified_at
              ? ` · Last checked ${formatVisitDate(place.last_verified_at)}`
              : ""}
          </p>
        </Card>
      </div>

      {place.description && (
        <>
          <SectionTitle>About</SectionTitle>
          <p className="px-5 text-[15px] leading-relaxed text-charcoal-muted [overflow-wrap:anywhere]">
            {place.description}
          </p>
        </>
      )}

      {place.veggie_reason && (
        <>
          <SectionTitle>Why Veggies Love It</SectionTitle>
          <p className="px-5 text-[15px] leading-relaxed text-charcoal-muted [overflow-wrap:anywhere]">
            {place.veggie_reason}
          </p>
        </>
      )}

      {/* Your support */}
      <SectionTitle>Your support</SectionTitle>
      <div className="px-5">
        <Card className="space-y-2 min-w-0">
          <p className="text-sm text-charcoal leading-relaxed">
            {mySupport.verified_visit_count === 0
              ? "You have not verified a visit here yet."
              : mySupport.verified_visit_count === 1
                ? "You have supported this Community Place once."
                : `You have supported this Community Place ${mySupport.verified_visit_count} times.`}
          </p>
          {mySupport.last_verified_visit_at && (
            <p className="text-xs text-charcoal-muted">
              Last verified visit {formatVisitDate(mySupport.last_verified_visit_at)}
            </p>
          )}
          <p className="text-xs text-charcoal-muted">
            {mySupport.counts_toward_supported_places
              ? "This place counts toward your Community Places Supported."
              : canCheckIn
                ? "Check in when you are at this place to add it to your Community Places Supported."
                : "Check-ins are unavailable here right now."}
          </p>
          {mySupport.counts_toward_supported_places && (
            <button
              type="button"
              onClick={() => navigate("/you/places-supported?from=place_detail")}
              className="text-sm font-semibold text-primary underline underline-offset-4"
            >
              View places you've supported
            </button>
          )}
        </Card>
      </div>

      {/* Upcoming Meetups */}
      <SectionTitle>Upcoming Meetups here</SectionTitle>
      <div className="px-5">
        {meetups.length > 0 ? (
          <div className="space-y-3">
            {meetups.slice(0, 3).map((m) => (
              <PlaceMeetupCard
                key={m.id}
                meetup={m}
                onOpen={() => {
                  logAnalyticsEvent("community_place_meetup_opened", { source: "place_detail" });
                  navigate(`/meetup/${m.id}`);
                }}
              />
            ))}
            {data!.upcoming_meetups_total > 3 && (
              <button
                type="button"
                onClick={() => navigate("/community?tab=meetups")}
                className="text-sm font-semibold text-primary underline underline-offset-4"
              >
                Show all upcoming Meetups
              </button>
            )}
          </div>
        ) : (
          <Card className="space-y-2 min-w-0">
            <h3 className="text-[15px] font-semibold text-charcoal">
              No upcoming Meetups here yet
            </h3>
            <p className="text-sm text-charcoal-muted leading-relaxed">
              This place can still be a great spot to bring the community together.
            </p>
            {canHost && (
              <PrimaryButton
                fullWidth
                className="mt-1"
                onClick={() => {
                  logAnalyticsEvent("community_place_host_started", { source: "place_detail" });
                  navigate(`/host?community_place=${place.id}`);
                }}
              >
                Host a Meetup here
              </PrimaryButton>
            )}
          </Card>
        )}
      </div>

      {/* Community impact */}
      <SectionTitle>Community impact</SectionTitle>
      <div className="px-5">
        <Card className="space-y-3 min-w-0">
          <ImpactRow
            icon={<Users className="w-4 h-4" aria-hidden />}
            label="Community members who supported this place"
            value={
              impact.supporter_threshold_met && impact.supporter_count !== null
                ? String(impact.supporter_count)
                : "Community support is growing"
            }
          />
          <ImpactRow
            icon={<CalendarDays className="w-4 h-4" aria-hidden />}
            label="Upcoming Meetups"
            value={String(impact.upcoming_meetups)}
          />
          <ImpactRow
            icon={<Sparkles className="w-4 h-4" aria-hidden />}
            label="Meetups hosted here"
            value={String(impact.meetups_hosted)}
          />
        </Card>
      </div>

      {/* Links & secondary actions */}
      <SectionTitle>More</SectionTitle>
      <div className="px-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          {place.website_url && (
            <a
              href={place.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control bg-muted text-sm font-semibold text-charcoal min-h-11"
            >
              <Globe className="w-4 h-4" aria-hidden />
              Visit official website (opens in a new tab)
            </a>
          )}
          {place.google_maps_url && (
            <a
              href={place.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                logAnalyticsEvent("community_place_directions_opened", { source: "maps_link" })
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control bg-muted text-sm font-semibold text-charcoal min-h-11"
            >
              <ExternalLink className="w-4 h-4" aria-hidden />
              Open this place on Google Maps
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={onShare}>
            <Share2 className="w-4 h-4 mr-1.5" aria-hidden />
            Share this place
          </SecondaryButton>
        </div>
        <p role="status" aria-live="polite" className="text-xs font-medium text-primary min-h-4">
          {shareMessage}
        </p>

        <div>
          <button
            type="button"
            onClick={() => {
              logAnalyticsEvent("community_place_report_started");
              navigate(`/place/${place.id}/report`);
            }}
            className="text-sm font-semibold text-charcoal-muted underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            Report an issue or suggest a correction
          </button>
          <p className="mt-1.5 text-xs text-charcoal-muted">
            Reports are private and reviewed by our team before anything changes.
          </p>
        </div>
      </div>

      {/* Sticky actions */}
      <div
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[var(--phone-max-width)] px-5 pt-4 pb-3 bg-gradient-to-t from-background via-background to-background/0"
        style={{ bottom: "var(--nav-height)" }}
      >
        <div className="flex gap-2">
          {canCheckIn && (
            <SecondaryButton
              className="flex-1 min-w-0 px-4 text-[15px]"
              onClick={() => setCheckInOpen(true)}
            >
              {mySupport.in_cooldown ? (
                <span className="truncate inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
                  Checked In
                </span>
              ) : (
                <span className="truncate">Check In</span>
              )}
            </SecondaryButton>
          )}
          {!canCheckIn && !isOperational && (
            <SecondaryButton
              className="flex-1 min-w-0 px-4 text-[15px]"
              disabled
              title="Check-ins are paused while this place isn't operational"
            >
              <span className="truncate">Check-in unavailable</span>
            </SecondaryButton>
          )}
          <PrimaryButton
            className="flex-1 min-w-0 px-4 text-[15px]"
            onClick={() => {
              logAnalyticsEvent("community_place_directions_opened", { source: "place_detail" });
              window.open(directionsHref, "_blank", "noopener,noreferrer");
            }}
          >
            <Navigation className="w-4 h-4 mr-1.5 shrink-0" aria-hidden />
            <span className="truncate">Get directions</span>
          </PrimaryButton>
        </div>
      </div>

      {canCheckIn && (
        <PlaceCheckInSheet
          open={checkInOpen}
          onOpenChange={setCheckInOpen}
          placeId={place.id}
          placeName={place.name}
          alreadyCheckedIn={mySupport.in_cooldown}
          directionsHref={directionsHref}
          onCheckedIn={() => refetch()}
          onViewImpact={() => navigate("/you/places-supported?from=check_in_success")}
        />
      )}
    </div>
  );
}

function PageFrame({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col min-h-dvh">
      <div className="safe-top flex items-center gap-2 page-x pt-3 pb-2">
        <BackButton onClick={() => { onBack(); }} />
        <h1 className="text-base font-semibold text-charcoal">Community Place</h1>
      </div>
      {children}
    </div>
  );
}

function ImpactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className="w-8 h-8 rounded-full bg-soft-green flex items-center justify-center text-primary shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">{value}</p>
        <p className="text-xs text-charcoal-muted [overflow-wrap:anywhere]">{label}</p>
      </div>
    </div>
  );
}

function PlaceMeetupCard({
  meetup,
  onOpen,
}: {
  meetup: PlaceDetailMeetup;
  onOpen: () => void;
}) {
  const full = meetup.attendee_count >= meetup.capacity;
  return (
    <Card interactive onClick={onOpen} className="space-y-1.5 min-w-0">
      <h3 className="text-[15px] font-semibold text-charcoal [overflow-wrap:anywhere]">
        {meetup.title}
      </h3>
      <p className="text-xs text-charcoal-muted">
        {formatMeetupWhen(meetup.date, meetup.start_time)}
      </p>
      <div className="flex items-center gap-2 flex-wrap text-xs text-charcoal-muted">
        {meetup.host_display_name && <span>Hosted by {meetup.host_display_name}</span>}
        <span className="inline-flex items-center gap-1">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {meetup.attendee_count} of {meetup.capacity} joined
        </span>
        {full && (
          <span className="px-2 py-0.5 rounded-full bg-muted font-semibold text-charcoal">
            Full
          </span>
        )}
      </div>
      <span className="inline-block text-sm font-semibold text-primary">View Meetup</span>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-5 mt-8 mb-3 text-lg font-semibold text-charcoal tracking-tight">
      {children}
    </h2>
  );
}
