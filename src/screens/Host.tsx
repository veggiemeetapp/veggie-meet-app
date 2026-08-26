import { isStaleClientError } from "@/lib/errors";
import { showErrorToast } from "@/lib/errorToast";
import { ToastAction } from "@/components/ui/toast";
import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  X,
  MapPin,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { AppHeader, PrimaryButton, SecondaryButton, BackButton } from "@/components/app";
import { CitySelector } from "@/components/location/CitySelector";
import { CommunityPlacePicker } from "@/components/host/CommunityPlacePicker";
import {
  CustomLocationSearch,
  type CustomLocationValue,
} from "@/components/host/CustomLocationSearch";
import { setMeetupGoogleLocationMeta } from "@/lib/meetupPlaceSearch";

import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/todayDate";
import { formatMeetupTimeRange } from "@/lib/format";

import type { CommunityPlace } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { logAnalyticsEvent } from "@/lib/analytics";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/hooks/useLocation";
import { fetchPublishedCommunityPlaces } from "@/lib/backend";
import { fetchInterestCatalogue } from "@/lib/onboarding";
import { MeetupInterestPicker } from "@/components/interests/MeetupInterestPicker";
import { labelForId } from "@/lib/interests";
import {
  validateMeetupDraft,
  classifyMeetupPublishError,
  issueSummary,
  publishFailureAnalytics,
  MEETUP_TITLE_MAX,
  MEETUP_DESCRIPTION_MAX,
  MEETUP_CAPACITY_MIN,
  MEETUP_CAPACITY_MAX,
  MEETUP_COVER_TARGET_CHARS,
  type FieldIssue,
  type MeetupField,
  type MeetupPublishError,
} from "@/lib/meetupPublishErrors";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CAPACITIES = [6, 10, 20, 30];
const CUSTOM_PLACE_ID = "__custom__";
const DEFAULT_COVER =
  "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-charcoal mb-2">
      {children}
    </label>
  );
}

export default function Host() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const contextQuery = useLocationContext();
  const fileRef = useRef<HTMLInputElement>(null);

  const homeCity = contextQuery.data?.home_city ?? null;
  const selectedCity = contextQuery.data?.selected_city ?? null;
  // Default: Selected City → Home City fallback.
  const defaultCityId = selectedCity?.id ?? homeCity?.id ?? null;
  const defaultCityName = selectedCity?.name ?? homeCity?.name ?? null;

  const [cover, setCover] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  // WO-124 — shared interest taxonomy tags for this Meetup.
  const [primaryInterestId, setPrimaryInterestId] = useState<string | null>(null);
  const [additionalInterestIds, setAdditionalInterestIds] = useState<string[]>([]);

  // Location step
  const [cityId, setCityId] = useState<string | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  // WO-123: custom location comes from a Google Places search; coordinates and
  // the Google reference are captured silently and never typed by the host.
  const [customLoc, setCustomLoc] = useState<CustomLocationValue>({
    name: "",
    address: "",
    latitude: null,
    longitude: null,
    googlePlaceId: null,
    googleMapsUrl: null,
  });
  const customName = customLoc.name;
  const customAddress = customLoc.address;


  const [date, setDate] = useState<string>(todayISO());
  const [startTime, setStartTime] = useState<string>("18:30");
  // WO-112: optional end time. "" means the host set no ending time (stored NULL).
  const [endTime, setEndTime] = useState<string>("");
  const [capacity, setCapacity] = useState<number>(10);

  const [isCustomCapacity, setIsCustomCapacity] = useState(false);
  const [customCapacity, setCustomCapacity] = useState<string>("");
  const [description, setDescription] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // WO-051: location mode (Community Place vs Custom location).
  const [searchParams] = useSearchParams();
  const preselectedPlaceId = searchParams.get("community_place");
  const preselectSource = preselectedPlaceId ? "place_detail" : "host_flow";
  const [locationMode, setLocationMode] = useState<"community_place" | "custom">(
    "community_place",
  );
  const [modeLogged, setModeLogged] = useState<string | null>(null);
  const [preselectApplied, setPreselectApplied] = useState(false);

  // WO-096 DEF-096-01: hosting intent is level 1 of the activation model and
  // had no telemetry, so "opened Host but never published" was invisible.
  useEffect(() => {
    logAnalyticsEvent("host_opened", { source: preselectSource });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed city from Selected/Home once context resolves.
  useEffect(() => {
    if (cityId || !defaultCityId || !defaultCityName) return;
    setCityId(defaultCityId);
    setCityName(defaultCityName);
  }, [defaultCityId, defaultCityName, cityId]);


  // Discovery list source of truth: published + verified + active + operational.
  const placesQuery = useQuery({
    queryKey: ["host-published-places", cityId],
    enabled: !!cityId,
    queryFn: () => fetchPublishedCommunityPlaces(cityId!),
    staleTime: 60_000,
  });

  // WO-124 — the approved interest taxonomy (single server-side source of truth).
  const interestCatalogue = useQuery({
    queryKey: ["interest-catalogue"],
    queryFn: fetchInterestCatalogue,
    staleTime: 60 * 60 * 1000,
  });

  // WO-053: places under status maintenance can't host new Meetups. The server
  // re-validates this on insert; this only keeps them out of the picker.
  const places = (placesQuery.data ?? []).filter(
    (p) => (p.maintenanceStatus ?? "operational") === "operational",
  );
  const isCustom = locationMode === "custom";
  const selectedPlace: CommunityPlace | undefined = isCustom
    ? undefined
    : places.find((p) => p.id === placeId);

  function selectMode(mode: "community_place" | "custom") {
    setLocationMode(mode);
    if (mode === "custom") setPlaceId(CUSTOM_PLACE_ID);
    else setPlaceId(null);
    if (modeLogged !== mode) {
      setModeLogged(mode);
      logAnalyticsEvent("meetup_location_mode_selected", {
        mode: mode === "custom" ? "custom" : "community_place",
      });
    }
  }

  // Preselect a Community Place arriving from /place/:id → Host a Meetup Here.
  // Invalid or unavailable ids fall back silently to the normal Host flow.
  useEffect(() => {
    if (preselectApplied || !preselectedPlaceId || places.length === 0) return;
    const match = places.find((p) => p.id === preselectedPlaceId);
    setPreselectApplied(true);
    if (!match) return;
    setLocationMode("community_place");
    setPlaceId(match.id);
    logAnalyticsEvent("meetup_community_place_selected", {
      place_id: match.id,
      source: "place_detail",
    });
  }, [preselectApplied, preselectedPlaceId, places]);

  // Coordinates now only ever arrive from a Google Places selection, so they
  // are valid by construction (both present or both absent).
  const coordsValid =
    (customLoc.latitude === null && customLoc.longitude === null) ||
    (customLoc.latitude !== null && customLoc.longitude !== null);


  const placeError =
    !isCustom && placeId === null && places.length > 0
      ? "Choose a Community Place, or switch to a custom location."
      : null;

  // WO-112: same-day range only. Blank end time is always valid; an end equal to
  // or before the start is not (overnight Meetups are out of scope — see §11).
  const endTimeError =
    endTime !== "" && endTime <= startTime
      ? "End time must be after the start time."
      : null;

  const canSubmit =
    title.trim().length > 0 &&
    !!primaryInterestId &&
    !!cityId &&
    !endTimeError &&
    (!isCustom
      ? !!selectedPlace
      : customName.trim().length > 0 && customAddress.trim().length > 0 && coordsValid);


  // WO-085A DEF-085A-06 (WCAG 3.3.1 / 3.3.2): the publish CTA used to be a
  // plain `disabled` button, so a keyboard or screen-reader host could neither
  // focus it nor discover what was still missing. The same requirements are now
  // named in a polite status message that the CTA points at with
  // aria-describedby, and the button stays focusable via aria-disabled.
  const missingRequirements: string[] = [
    ...(title.trim().length === 0 ? ["a Meetup title"] : []),
    ...(!primaryInterestId ? ["a main category"] : []),
    ...(!cityId ? ["a city"] : []),
    ...(!isCustom
      ? !selectedPlace
        ? ["a Community Place"]
        : []
      : [
          ...(customName.trim().length === 0 ? ["a location name"] : []),
          ...(customAddress.trim().length === 0 ? ["a location address"] : []),
          ...(!coordsValid ? ["valid coordinates"] : []),
        ]),
  ];

  // WO-112 §36: End time is optional, so it never appears in the missing
  // required-fields list — an invalid range is reported as its own message.
  const ctaStatusMessage = canSubmit
    ? "All required Meetup details are complete."
    : missingRequirements.length > 0
      ? `Still needed: ${missingRequirements.join(", ")}.`
      : (endTimeError ?? "Please review the Meetup details.");



  // WO-131 / DEF-131-01 root cause: the cover was stored as an unbounded
  // base64 data URL, while `create_hosted_meetup` rejects anything over
  // 500,000 characters. A normal phone photo re-encoded at 1280px/q0.8 can
  // exceed that, so publishing failed after the host had filled the whole
  // form. The cover is now re-encoded down until it fits the server limit,
  // and a cover that still can't fit is reported as a cover problem — never
  // as a Meetup-field problem.
  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const attempts: Array<{ max: number; quality: number }> = [
        { max: 1280, quality: 0.8 },
        { max: 1280, quality: 0.65 },
        { max: 1024, quality: 0.6 },
        { max: 800, quality: 0.55 },
        { max: 640, quality: 0.5 },
      ];
      for (const attempt of attempts) {
        const scale = Math.min(1, attempt.max / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", attempt.quality);
        if (url.length <= MEETUP_COVER_TARGET_CHARS) {
          setCover(url);
          return;
        }
      }
      setCover(null);
      setCoverError(
        "That cover photo is too large to attach. Choose a smaller image, or publish without a cover.",
      );
      logAnalyticsEvent("request_failed", {
        category: "domain",
        surface: "host_cover",
        code: "MEETUP_COVER_TOO_LARGE",
        retryable: false,
      });
    } catch {
      setCover(null);
      setCoverError("Your cover photo couldn’t be saved. Please try uploading it again.");
    }
  }



  // Resolve the persisted snapshot fields we send to the DB.
  const resolved = useMemo(() => {
    if (!cityId) return null;
    if (isCustom) {
      const lat = customLoc.latitude;
      const lng = customLoc.longitude;

      return {
        cityId,
        cityName,
        communityPlaceId: null as string | null,
        locationName: customName.trim(),
        address: customAddress.trim() || null,
        neighborhood: null as string | null,
        latitude: lat,
        longitude: lng,
        timezone:
          selectedCity?.id === cityId ? selectedCity?.timezone ?? null
          : homeCity?.id === cityId ? homeCity?.timezone ?? null
          : null,
        locationSource: "custom_location" as const,
      };
    }
    if (!selectedPlace) return null;
    return {
      cityId,
      cityName: selectedPlace.cityName ?? cityName,
      communityPlaceId: selectedPlace.id,
      locationName: selectedPlace.name,
      address: selectedPlace.address ?? null,
      neighborhood: selectedPlace.neighborhood ?? null,
      // WO-061A: coordinates for a Community Place are filled in server-side.
      latitude: null,
      longitude: null,
      timezone: selectedPlace.timezone ?? selectedCity?.timezone ?? homeCity?.timezone ?? null,
      locationSource: "community_place" as const,
    };
  }, [
    cityId, cityName, isCustom, customLoc,
    selectedPlace, selectedCity, homeCity,
  ]);


  // WO-126 — canonical display labels for the Review & publish summary.
  const catalogueOptions = interestCatalogue.data ?? [];
  const primaryCategoryLabel = labelForId(catalogueOptions, primaryInterestId);
  const additionalCategoryLabels = additionalInterestIds
    .map((id) => labelForId(catalogueOptions, id))
    .filter((l): l is string => !!l);

  async function submit() {
    if (!canSubmit || !resolved || !profile?.id) return;
    setSaving(true);
    try {
      // WO-076: creation is server-authoritative. Host identity is derived
      // from auth inside `create_hosted_meetup` — never sent from the client —
      // and every field (times, capacity, category, timezone, location) is
      // validated server-side before a Meetup row can exist.
      const { data, error } = await (supabase.rpc as any)("create_hosted_meetup", {
        _title: title.trim(),
        _description: description.trim(),
        // WO-126: the legacy category column is now derived server-side from
        // the canonical Primary category. The argument is retained only for
        // wire compatibility and is ignored by `create_hosted_meetup`.
        _category: null,
        _date: date,
        _start_time: startTime,
        _end_time: endTime === "" ? null : endTime,
        _capacity: capacity,
        _city_id: resolved.cityId,
        _community_place_id: resolved.communityPlaceId,
        _location_name: resolved.locationName,
        _address: resolved.address,
        _neighborhood: resolved.neighborhood,
        _latitude: resolved.latitude,
        _longitude: resolved.longitude,
        _timezone: resolved.timezone,
        _cover_image_url: cover || DEFAULT_COVER,
        _primary_interest_id: primaryInterestId,
        _additional_interest_ids: additionalInterestIds,
      });

      if (error) throw error;
      const newId = data as string | null;
      if (newId) {
        // WO-123: store the Google reference for the chosen custom location.
        // Non-fatal — the Meetup already exists and reads fine without it.
        if (isCustom && customLoc.googlePlaceId) {
          try {
            await setMeetupGoogleLocationMeta(
              newId,
              customLoc.googlePlaceId,
              customLoc.googleMapsUrl,
            );
          } catch {
            /* ignore — cosmetic metadata only */
          }
        }



        // WO-042 §9: authoritative, once-only event fired only after the
        // backend insert succeeded. No PII — enums, ids and counts only.
        logAnalyticsEvent("meetup_created", {
          meetup_id: newId,
          capacity,
          city_id: resolved.cityId,
          location_source: resolved.locationSource,
          has_custom_cover: Boolean(cover),
          // WO-112 §48: boolean only — no raw timestamps.
          has_end_time: endTime !== "",
          // WO-124 §: taxonomy ids and a count only — never free text.
          primary_interest_id: primaryInterestId,
          additional_interest_count: additionalInterestIds.length,

        });
        if (resolved.communityPlaceId) {
          logAnalyticsEvent("meetup_created_at_community_place", {
            meetup_id: newId,
            place_id: resolved.communityPlaceId,
          });
        }

        setConfirmOpen(false);
        navigate(`/meetup-created/${newId}`);
        return;
      }
    } catch (e) {
      // WO-124F / DEF-124F-01: single normalization path — one member-safe
      // toast plus exactly one non-PII `request_failed` event. A stale app
      // shell (pre-WO-124 payload) additionally gets a Reload affordance.
      // WO-124G / DEF-124G-01: the confirmation dialog must close first —
      // a modal Radix dialog disables pointer events on the rest of the page
      // and traps focus, which made the toast's Reload action unreachable by
      // both pointer and keyboard. Nothing was saved, so closing is safe and
      // the entered form details are still on the form behind it.
      setConfirmOpen(false);
      const stale = isStaleClientError(e);

      showErrorToast(e, {
        surface: "host_create",
        titleOverride: stale ? undefined : "Couldn't create Meetup",
        action: stale ? (
          <ToastAction
            altText="Reload VeggieMeet to get the latest version"
            onClick={() => {
              if (
                window.confirm(
                  "Reload VeggieMeet now? Details you've entered on this form will be cleared.",
                )
              ) {
                window.location.reload();
              }
            }}
          >
            Reload
          </ToastAction>
        ) : undefined,
      });

    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Host a Meetup"
        subtitle="Bring Veggies together around something you enjoy."
        left={
          <BackButton fallback="/" />
        }
      />

      <div className="px-5 py-6 space-y-7 pb-32">
        {/* WO-096 DEF-096-04: first-time hosts had no expectation setting —
            nothing said who can see a published Meetup, or that a small,
            simple plan is enough. */}
        <section
          aria-label="What hosting involves"
          className="rounded-card border border-border bg-muted/40 p-4"
        >
          <p className="text-sm text-charcoal copy">
            Keep it simple — a time, a place, and a few Veggies is enough.
          </p>
          <p className="mt-1.5 text-xs text-charcoal-muted copy">
            Once published, your Meetup is visible to Veggies in the city you choose, and they
            can join until it’s full. You can edit or cancel it any time from My Plans.
          </p>
        </section>


        {/* Cover */}
        <section>
          <FieldLabel>Meetup cover</FieldLabel>
          {cover ? (
            <div className="relative rounded-card overflow-hidden">
              <img src={cover} alt="Meetup cover" className="w-full h-44 object-cover" />
              <button
                type="button"
                onClick={() => setCover(null)}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/90 flex items-center justify-center shadow-soft"
              >
                <X className="w-4 h-4 text-charcoal" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full h-40 rounded-card border-2 border-dashed border-border bg-muted/40 flex flex-col items-center justify-center gap-2 text-charcoal-muted hover:bg-accent/40 transition"
            >
              <Camera className="w-6 h-6" />
              <span className="text-sm font-medium">Add a photo (optional)</span>
            </button>
          )}
          {!cover && (
            <p className="mt-2 text-xs text-charcoal-muted text-center">
              Skip for now — you can add one later.
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImage}
          />
        </section>

        {/* Title */}
        <section>
          <FieldLabel>Meetup title</FieldLabel>
          <input aria-label="Meetup title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Saturday Coffee Meetup"
            className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </section>

        {/* WO-126 — the canonical taxonomy is the only classification UI */}
        <section>
          <FieldLabel>Category</FieldLabel>
          <p className="mb-3 text-xs text-charcoal-muted">
            Pick one main category, plus up to two optional extras. We use these to
            suggest your Meetup to Veggies with matching interests.
          </p>
          <MeetupInterestPicker
            options={interestCatalogue.data ?? []}
            loading={interestCatalogue.isLoading}
            primaryId={primaryInterestId}
            additionalIds={additionalInterestIds}
            onPrimaryChange={setPrimaryInterestId}
            onAdditionalChange={setAdditionalInterestIds}
            suggestFrom={`${title} ${description}`}
          />
        </section>

        {/* Location — required */}
        <section>
          <FieldLabel>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-4 h-4" /> Location
            </span>
          </FieldLabel>

          <div className="rounded-card border border-border bg-card p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-1.5">
                City
              </div>
              <CitySelector
                variant="block"
                value={cityId}
                triggerLabel={cityName ?? "Choose city"}
                title="Meetup city"
                onSelect={(id, name) => {
                  setCityId(id);
                  setCityName(name);
                  if (locationMode === "community_place") setPlaceId(null);

                }}
              />
              {defaultCityId && cityId === defaultCityId && (
                <p className="mt-1.5 text-[11px] text-charcoal-muted">
                  Using your {selectedCity && selectedCity.id === cityId ? "Selected" : "Home"} City by default.
                </p>
              )}
            </div>

            <div>
              <div
                id="host-location-mode-label"
                className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-1.5"
              >
                Location type
              </div>
              <div
                role="radiogroup"
                aria-labelledby="host-location-mode-label"
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    { mode: "community_place" as const, label: "Community Place" },
                    { mode: "custom" as const, label: "Custom location" },
                  ]
                ).map((opt) => {
                  const active = locationMode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => selectMode(opt.mode)}
                      className={cn(
                        "h-11 px-3 rounded-control border text-sm font-semibold transition-all",
                        active
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-card text-charcoal border-border hover:bg-accent/50",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                {locationMode === "community_place" ? (
                  !cityId ? (
                    <p className="text-sm text-charcoal-muted">Pick a city first.</p>
                  ) : (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-1.5">
                        Choose a Community Place
                      </div>
                      <CommunityPlacePicker
                        places={places}
                        loading={placesQuery.isPending}
                        errored={placesQuery.isError}
                        onRetry={() => placesQuery.refetch()}
                        selectedPlaceId={isCustom ? null : placeId}
                        onSelect={(p) => {
                          setPlaceId(p.id);
                          logAnalyticsEvent("meetup_community_place_selected", {
                            place_id: p.id,
                            source: preselectSource,
                          });
                        }}
                        onUseCustom={() => selectMode("custom")}
                        onSuggestPlace={() => navigate("/community/places/suggest")}
                        onViewPlace={(pid) => navigate(`/place/${pid}`)}
                      />
                      {/* WO-096 DEF-096-03: a first-time host could reasonably
                          assume picking a Community Place books a table. It
                          does not — VeggieMeet never contacts or reserves at a
                          venue, so say so where the choice is made. */}
                      <p className="mt-2 text-xs text-charcoal-muted copy">
                        Choosing a place sets where your Meetup happens. VeggieMeet doesn’t
                        contact the venue or reserve a table — arrange that yourself if your
                        group needs it.
                      </p>

                      {placeError && (
                        <p
                          id="host-location-error"
                          role="alert"
                          className="mt-2 text-xs text-destructive"
                        >
                          {placeError}
                        </p>
                      )}
                    </>
                  )
                ) : null}
              </div>
            </div>

            <div>
              <div className="space-y-2">
                {/* WO-123: custom location = Google Places search-and-select,
                    with manual entry as the fallback. No coordinate fields. */}
                {isCustom && (
                  <CustomLocationSearch
                    value={customLoc}
                    onChange={setCustomLoc}
                    region={
                      selectedCity?.id === cityId
                        ? selectedCity?.country_code
                        : homeCity?.id === cityId
                          ? homeCity?.country_code
                          : null
                    }
                    onEvent={(event, detail) =>
                      logAnalyticsEvent(`meetup_custom_location_${event}`, detail ?? {})
                    }
                  />
                )}
              </div>
            </div>


          </div>
        </section>

        {/* Date, start time & optional end time (WO-112) */}
        <section className="space-y-3">
          <div>
            <label
              htmlFor="host-date"
              className="block text-sm font-semibold text-charcoal mb-2"
            >
              Date
            </label>
            <input
              id="host-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-12 rounded-control border border-border bg-card px-3 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {/* WO-112B: rem-based flex basis instead of a viewport breakpoint, so
              the pair sits side by side when there is room and wraps to a stack
              on very narrow phones AND at large text sizes (200% zoom), where a
              two-column grid clipped the native time inputs. */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 basis-[10rem] min-w-0">

              <label
                htmlFor="host-start-time"
                className="block text-sm font-semibold text-charcoal mb-2"
              >
                Start time
              </label>
              <input
                id="host-start-time"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full h-12 rounded-control border border-border bg-card px-3 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex-1 basis-[10rem] min-w-0">

              <label
                htmlFor="host-end-time"
                className="block text-sm font-semibold text-charcoal mb-2"
              >
                End time{" "}
                <span className="font-normal text-charcoal-muted">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="host-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  aria-invalid={endTimeError ? true : undefined}
                  aria-describedby={
                    endTimeError ? "host-end-time-error" : "host-end-time-hint"
                  }
                  className="w-full h-12 rounded-control border border-border bg-card px-3 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {endTime !== "" && (
                  <button
                    type="button"
                    onClick={() => setEndTime("")}
                    aria-label="Clear end time"
                    className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-charcoal-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {endTimeError ? (
                <p id="host-end-time-error" className="mt-1.5 text-xs text-destructive">
                  {endTimeError}
                </p>
              ) : (
                <p id="host-end-time-hint" className="mt-1.5 text-xs text-charcoal-muted">
                  Leave blank if there’s no set end time.
                </p>
              )}
            </div>
          </div>
        </section>


        {/* Capacity */}
        <section>
          <FieldLabel>Group size (including you)</FieldLabel>
          {/* WO-112B: wrap so the row never forces horizontal page overflow at
              large text sizes. */}
          <div className="flex flex-wrap gap-2">

            {CAPACITIES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setCapacity(n);
                  setIsCustomCapacity(false);
                }}
                className={cn(
                  "flex-1 h-11 rounded-control border font-semibold transition-all",
                  !isCustomCapacity && capacity === n
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-charcoal border-border hover:bg-accent/50",
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIsCustomCapacity(true)}
              className={cn(
                "flex-1 h-11 rounded-control border font-semibold transition-all",
                isCustomCapacity
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-charcoal border-border hover:bg-accent/50",
              )}
            >
              Custom
            </button>
          </div>
          {isCustomCapacity && (
            <input
              aria-label="Custom group size"
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              value={customCapacity}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, "");
                setCustomCapacity(raw);
                const n = parseInt(raw, 10);
                if (!Number.isNaN(n) && n > 0 && n <= 500) setCapacity(n);
              }}
              placeholder="Enter a number"
              className="mt-3 w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
        </section>

        {/* Description */}
        <section>
          <FieldLabel>Description</FieldLabel>
          <textarea aria-label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell everyone what to expect."
            rows={4}
            className="w-full rounded-control border border-border bg-card px-4 py-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </section>

      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-nav inset-x-0 mx-auto max-w-phone bg-background/95 backdrop-blur-xl border-t border-border safe-bottom">
        <div className="px-5 py-4">
          <PrimaryButton
            fullWidth
            onClick={() => {
              if (canSubmit) setConfirmOpen(true);
            }}
            aria-disabled={!canSubmit}
            aria-describedby={canSubmit ? undefined : "host-cta-requirements"}
            className={canSubmit ? undefined : "opacity-50"}
          >
            Review & publish
          </PrimaryButton>
          <p
            id="host-cta-requirements"
            role="status"
            className={cn(
              "mt-2 text-xs text-charcoal-muted text-center",
              canSubmit && "sr-only",
            )}
          >
            {ctaStatusMessage}

          </p>
        </div>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this Meetup?</DialogTitle>
            <DialogDescription>
              Please confirm the details below. Attendees will see this exact location.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-2 rounded-control border border-border bg-muted/40 p-3 text-sm">
            <div className="font-semibold text-charcoal [overflow-wrap:anywhere]">
              {title || "Untitled Meetup"}
            </div>
            <div className="text-charcoal-muted">
              {date} · {formatMeetupTimeRange(startTime, endTime)} · up to {capacity} Veggies
            </div>
            {/* WO-126 — canonical categories only; no legacy category is shown. */}
            {primaryCategoryLabel && (
              <div className="pt-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
                  Category
                </div>
                <div className="text-charcoal">
                  Main: {primaryCategoryLabel}
                </div>
                {additionalCategoryLabels.length > 0 && (
                  <div className="text-xs text-charcoal-muted">
                    Additional: {additionalCategoryLabels.join(", ")}
                  </div>
                )}
              </div>
            )}
            {resolved && (
              <div className="pt-1">
                <div className="text-charcoal [overflow-wrap:anywhere]">
                  <MapPin className="inline w-3.5 h-3.5 mr-1" />
                  {resolved.locationName}
                </div>
                {resolved.address && (
                  <div className="text-xs text-charcoal-muted [overflow-wrap:anywhere]">
                    {resolved.address}
                  </div>
                )}
                <div className="text-xs text-charcoal-muted">
                  {[resolved.neighborhood, resolved.cityName ?? cityName]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · Timezone {resolved.timezone ?? "not set"}
                </div>
                {selectedPlace && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {selectedPlace.veggieClassification === "fully_vegan" && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-soft-green text-primary">
                        100% Vegan
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => window.open(`/place/${selectedPlace.id}`, "_blank", "noopener,noreferrer")}
                      className="text-xs font-semibold text-primary"
                    >
                      View Place
                    </button>
                  </div>
                )}
              </div>
            )}
            {description.trim() && (
              <p className="text-xs text-charcoal-muted [overflow-wrap:anywhere] line-clamp-4">
                {description.trim()}
              </p>
            )}
            {selectedPlace && (
              <p className="text-[11px] text-charcoal-muted">
                This Meetup is hosted by a VeggieMeet member. The venue may not be
                affiliated with VeggieMeet.
              </p>
            )}
          </div>

          {resolved && !resolved.timezone && (
            <div className="mt-2 flex items-start gap-2 text-xs text-warning bg-warning-soft border border-warning-border rounded-control p-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              This city has no timezone on file — display times may be off.
            </div>
          )}
          <DialogFooter>
            <SecondaryButton onClick={() => setConfirmOpen(false)} disabled={saving}>
              Keep editing
            </SecondaryButton>
            <PrimaryButton onClick={submit} disabled={saving || !resolved}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Publishing…
                </>
              ) : (
                "Publish Meetup"
              )}
            </PrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
