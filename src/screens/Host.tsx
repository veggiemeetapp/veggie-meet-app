import { memberSafeMessage } from "@/lib/errors";
import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, X, MapPin, Loader2, AlertTriangle } from "lucide-react";
import { AppHeader, PrimaryButton, SecondaryButton } from "@/components/app";
import { CitySelector } from "@/components/location/CitySelector";
import { CommunityPlacePicker } from "@/components/host/CommunityPlacePicker";
import { cn } from "@/lib/utils";
import { TODAY_ISO } from "@/lib/mock-data";
import type { CommunityPlace, MeetupCategory } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { logAnalyticsEvent } from "@/lib/analytics";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/hooks/useLocation";
import { fetchPublishedCommunityPlaces } from "@/lib/backend";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const CATEGORIES: { id: MeetupCategory; label: string; emoji: string }[] = [
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "dinner", label: "Dinner", emoji: "🥗" },
  { id: "brunch", label: "Brunch", emoji: "🍳" },
  { id: "walk", label: "Walking", emoji: "🚶" },
  { id: "other", label: "Board Games", emoji: "🎲" },
  { id: "walk", label: "Hiking", emoji: "🥾" },
  { id: "cooking", label: "Cooking", emoji: "🍽️" },
  { id: "other", label: "Farmers Market", emoji: "🧺" },
  { id: "other", label: "Volunteering", emoji: "🌿" },
  { id: "other", label: "Other", emoji: "✨" },
];

const EXPECTATIONS = [
  "Casual Conversation",
  "Everyone Welcome",
  "Vegetarian Friendly",
  "Beginner Friendly",
  "Small Group",
  "Outdoor",
  "Indoor",
];

const CAPACITIES = [6, 10, 20, 30];
const CUSTOM_PLACE_ID = "__custom__";
const DEFAULT_COVER =
  "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all active:scale-[0.97]",
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-card text-charcoal border-border hover:bg-accent/60",
      )}
    >
      {children}
    </button>
  );
}

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
  const [categoryIdx, setCategoryIdx] = useState<number | null>(null);

  // Location step
  const [cityId, setCityId] = useState<string | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  // Optional coordinates for custom locations (both required or both blank).
  const [customLat, setCustomLat] = useState("");
  const [customLng, setCustomLng] = useState("");

  const [date, setDate] = useState<string>(TODAY_ISO);
  const [startTime, setStartTime] = useState<string>("18:30");
  const [capacity, setCapacity] = useState<number>(10);
  const [isCustomCapacity, setIsCustomCapacity] = useState(false);
  const [customCapacity, setCustomCapacity] = useState<string>("");
  const [description, setDescription] = useState("");
  const [expectations, setExpectations] = useState<string[]>([]);
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

  const coordsValid =
    (customLat === "" && customLng === "") ||
    (Number.isFinite(Number(customLat)) &&
      Number.isFinite(Number(customLng)) &&
      Number(customLat) >= -90 && Number(customLat) <= 90 &&
      Number(customLng) >= -180 && Number(customLng) <= 180);

  const placeError =
    !isCustom && placeId === null && places.length > 0
      ? "Choose a Community Place, or switch to a custom location."
      : null;

  const canSubmit =
    title.trim().length > 0 &&
    categoryIdx !== null &&
    !!cityId &&
    (!isCustom
      ? !!selectedPlace
      : customName.trim().length > 0 && customAddress.trim().length > 0 && coordsValid);


  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const MAX = 1280;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setCover(canvas.toDataURL("image/jpeg", 0.8));
    } catch {
      const reader = new FileReader();
      reader.onload = () => setCover(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  function toggleExpectation(item: string) {
    setExpectations((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
    );
  }

  function addMinutes(hhmm: string, mins: number): string {
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + mins;
    const nh = Math.floor(total / 60) % 24;
    const nm = total % 60;
    return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
  }

  // Resolve the persisted snapshot fields we send to the DB.
  const resolved = useMemo(() => {
    if (!cityId) return null;
    if (isCustom) {
      const lat = customLat === "" ? null : Number(customLat);
      const lng = customLng === "" ? null : Number(customLng);
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
    cityId, cityName, isCustom, customName, customAddress, customLat, customLng,
    selectedPlace, selectedCity, homeCity,
  ]);

  async function submit() {
    if (!canSubmit || categoryIdx === null || !resolved || !profile?.id) return;
    setSaving(true);
    const cat = CATEGORIES[categoryIdx];
    try {
      // WO-076: creation is server-authoritative. Host identity is derived
      // from auth inside `create_hosted_meetup` — never sent from the client —
      // and every field (times, capacity, category, timezone, location) is
      // validated server-side before a Meetup row can exist.
      const { data, error } = await (supabase.rpc as any)("create_hosted_meetup", {
        _title: title.trim(),
        _description: description.trim(),
        _category: cat.id,
        _date: date,
        _start_time: startTime,
        _end_time: addMinutes(startTime, 120),
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
      });

      if (error) throw error;
      const newId = data as string | null;
      if (newId) {

        // WO-042 §9: authoritative, once-only event fired only after the
        // backend insert succeeded. No PII — enums, ids and counts only.
        logAnalyticsEvent("meetup_created", {
          meetup_id: newId,
          category: cat.id,
          capacity,
          city_id: resolved.cityId,
          location_source: resolved.locationSource,
          has_custom_cover: Boolean(cover),
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
      toast.error("Couldn't create Meetup", {
        description: memberSafeMessage(e),
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
          <button
            onClick={() => safeBack(navigate, "/")}
            aria-label="Back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        }
      />

      <div className="px-5 py-6 space-y-7 pb-32">
        {/* Cover */}
        <section>
          <FieldLabel>Meetup cover</FieldLabel>
          {cover ? (
            <div className="relative rounded-2xl overflow-hidden">
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
              className="w-full h-40 rounded-2xl border-2 border-dashed border-border bg-muted/40 flex flex-col items-center justify-center gap-2 text-charcoal-muted hover:bg-accent/40 transition"
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
            className="w-full h-12 rounded-xl border border-border bg-card px-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </section>

        {/* Category */}
        <section>
          <FieldLabel>Category</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c, i) => (
              <Chip key={i} active={categoryIdx === i} onClick={() => setCategoryIdx(i)}>
                <span className="mr-1">{c.emoji}</span>
                {c.label}
              </Chip>
            ))}
          </div>
        </section>

        {/* Location — required */}
        <section>
          <FieldLabel>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-4 h-4" /> Location
            </span>
          </FieldLabel>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
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
                        "h-11 px-3 rounded-xl border text-sm font-semibold transition-all",
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
                {/* Custom-location fields (preserved behavior) */}


                  {isCustom && (
                    <div className="mt-2 space-y-3 rounded-2xl border border-border bg-muted/30 p-3">
                      <div>
                        <FieldLabel>Location name</FieldLabel>
                        <input aria-label="Location name"
                          type="text"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                          placeholder="e.g. Riverside Park pavilion"
                          className="w-full h-11 rounded-xl border border-border bg-card px-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <FieldLabel>Street address</FieldLabel>
                        <input aria-label="Street address"
                          type="text"
                          value={customAddress}
                          onChange={(e) => setCustomAddress(e.target.value)}
                          placeholder="Street, District, City"
                          className="w-full h-11 rounded-xl border border-border bg-card px-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel>Latitude (optional)</FieldLabel>
                          <input aria-label="Latitude (optional)"
                            type="text"
                            inputMode="decimal"
                            value={customLat}
                            onChange={(e) => setCustomLat(e.target.value)}
                            placeholder="10.7769"
                            className="w-full h-11 rounded-xl border border-border bg-card px-3 text-base text-charcoal"
                          />
                        </div>
                        <div>
                          <FieldLabel>Longitude (optional)</FieldLabel>
                          <input aria-label="Longitude (optional)"
                            type="text"
                            inputMode="decimal"
                            value={customLng}
                            onChange={(e) => setCustomLng(e.target.value)}
                            placeholder="106.7009"
                            className="w-full h-11 rounded-xl border border-border bg-card px-3 text-base text-charcoal"
                          />
                        </div>
                      </div>
                      {!coordsValid && (
                        <p className="text-xs text-destructive">
                          Coordinates must both be provided (or both blank) and within valid ranges.
                        </p>
                      )}
                      <p className="text-[11px] text-charcoal-muted">
                        Timezone is set from the city automatically.
                      </p>
                    </div>
                  )}
              </div>
            </div>

          </div>
        </section>

        {/* Date & Time */}
        <section className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Date</FieldLabel>
            <input aria-label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-12 rounded-xl border border-border bg-card px-3 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <FieldLabel>Time</FieldLabel>
            <input aria-label="Time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full h-12 rounded-xl border border-border bg-card px-3 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </section>

        {/* Capacity */}
        <section>
          <FieldLabel>Group size (including you)</FieldLabel>
          <div className="flex gap-2">
            {CAPACITIES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setCapacity(n);
                  setIsCustomCapacity(false);
                }}
                className={cn(
                  "flex-1 h-11 rounded-xl border font-semibold transition-all",
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
                "flex-1 h-11 rounded-xl border font-semibold transition-all",
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
              className="mt-3 w-full h-12 rounded-xl border border-border bg-card px-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
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
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </section>

        {/* What to expect */}
        <section>
          <FieldLabel>What to expect</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {EXPECTATIONS.map((item) => (
              <Chip
                key={item}
                active={expectations.includes(item)}
                onClick={() => toggleExpectation(item)}
              >
                {item}
              </Chip>
            ))}
          </div>
        </section>
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-nav inset-x-0 mx-auto max-w-phone bg-background/95 backdrop-blur-xl border-t border-border safe-bottom">
        <div className="px-5 py-4">
          <PrimaryButton
            fullWidth
            onClick={() => setConfirmOpen(true)}
            disabled={!canSubmit}
          >
            Review & publish
          </PrimaryButton>
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
          <div className="mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <div className="font-semibold text-charcoal [overflow-wrap:anywhere]">
              {title || "Untitled Meetup"}
            </div>
            <div className="text-charcoal-muted">
              {date} · {startTime} · up to {capacity} Veggies
            </div>
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
            <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
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
