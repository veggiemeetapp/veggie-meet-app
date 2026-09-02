import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Clock,
  Loader2,
  MapPin,
  Users,
  UserMinus,
  AlertTriangle,
  Save,
  Ban,
  CheckCircle2,
  X,, UserPlus } from "lucide-react";
import { AppHeader, PrimaryButton, SecondaryButton, UserAvatar, BackButton } from "@/components/app";
import { InviteVeggiesSheet } from "@/components/invitations/InviteVeggiesSheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { fetchInterestCatalogue } from "@/lib/onboarding";
import { MeetupInterestPicker } from "@/components/interests/MeetupInterestPicker";
import { recoverPrimaryInterest } from "@/lib/meetupLegacyInterest";
import { fetchPublishedCommunityPlaces, fetchMeetupById, fetchCommunityPlaceById, FALLBACK_COVER } from "@/lib/backend";
import { CommunityPlacePicker } from "@/components/host/CommunityPlacePicker";
import {
  CustomLocationSearch,
  type CustomLocationValue,
} from "@/components/host/CustomLocationSearch";
import { setMeetupGoogleLocationMeta } from "@/lib/meetupPlaceSearch";

import { supabase } from "@/integrations/supabase/client";
import {
  fetchMeetupAttendees,
  updateHostedMeetup,
  cancelMeetup,
  removeMeetupAttendee,
  type ManagedAttendee,
} from "@/lib/meetupManagement";
import { updateMeetupLocation } from "@/lib/location";
import { fetchMeetupPlaceContext } from "@/lib/meetupPlaceContext";
import {
  blockedReasonCopy,
  completeHostedMeetup,
  fetchMeetupLifecycle,
} from "@/lib/meetupLifecycle";
import { logAnalyticsEvent } from "@/lib/analytics";

import { MeetupLocationStatus } from "@/components/meetup";
import { MeetupCoverEditor } from "@/components/meetup/MeetupCoverEditor";
import {
  COVER_DRAFT_UNCHANGED,
  coverSaveErrorMessage,
  previewCover,
  resolveCoverUpdate,
  type CoverDraft,
} from "@/lib/meetupCover";
import { CitySelector } from "@/components/location/CitySelector";
import { useLocationContext } from "@/hooks/useLocation";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { CommunityPlace } from "@/types";


function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-charcoal mb-2">{children}</label>
  );
}


const CUSTOM_PLACE_ID = "__custom__";


export default function MeetupManagement() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  const meetupQuery = useQuery({
    queryKey: ["managed-meetup", id],
    enabled: !!id && !authLoading,
    queryFn: () => fetchMeetupById(id!),
  });

  // WO-062 — server-derived comparison of the Meetup snapshot vs. the current
  // Community Place. Read-only; never rewrites the snapshot.
  const placeContextQuery = useQuery({
    queryKey: ["meetup-place-context", id],
    enabled: !!id && !authLoading,
    queryFn: () => fetchMeetupPlaceContext(id!),
  });

  const attendeesQuery = useQuery({
    queryKey: ["managed-attendees", id],
    enabled: !!id && !authLoading,
    queryFn: () => fetchMeetupAttendees(id!),
  });

  // WO-063 — single server-authoritative lifecycle read model.
  const lifecycleQuery = useQuery({
    queryKey: ["meetup-lifecycle", id],
    enabled: !!id && !authLoading,
    queryFn: () => fetchMeetupLifecycle(id!),
  });


  const meetup = meetupQuery.data;
  const isHost = !!(meetup && profile?.id && meetup.hostId === profile.id);

  // Local edit-form state, hydrated from meetup once loaded.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("18:30");
  // WO-112: optional end time. "" means "no specified ending time" (NULL).
  const [endTime, setEndTime] = useState("");

  const [capacity, setCapacity] = useState(10);
  // WO-124 — interest tags (shared taxonomy) for this Meetup.
  const [primaryInterestId, setPrimaryInterestId] = useState<string | null>(null);
  const [additionalInterestIds, setAdditionalInterestIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // WO-133 — staged cover edit. Nothing is written until Save, so unrelated
  // fields are never touched by a cover change and Remove is reversible.
  const [coverDraft, setCoverDraft] = useState<CoverDraft>(COVER_DRAFT_UNCHANGED);
  const [coverSaveError, setCoverSaveError] = useState<string | null>(null);


  // Location editor state (independent from the main Save; uses update_meetup_location).
  const contextQuery = useLocationContext();
  const [locCityId, setLocCityId] = useState<string | null>(null);
  const [locCityName, setLocCityName] = useState<string | null>(null);
  const [locPlaceId, setLocPlaceId] = useState<string | null>(null);
  // WO-123: the custom location is chosen through Google Places search;
  // coordinates and the Google reference are never typed by the host.
  const [locCustom, setLocCustom] = useState<CustomLocationValue>({
    name: "",
    address: "",
    latitude: null,
    longitude: null,
    googlePlaceId: null,
    googleMapsUrl: null,
  });

  const [locConfirmOpen, setLocConfirmOpen] = useState(false);
  const [locSaving, setLocSaving] = useState(false);

  useEffect(() => {
    if (!meetup) return;
    setTitle(meetup.title);
    setDescription(meetup.description ?? "");
    setDate(meetup.date);
    setStartTime(meetup.startTime);
    setEndTime(meetup.endTime ?? "");
    setCapacity(meetup.capacity);
    setPrimaryInterestId(meetup.primaryInterestId ?? null);
    setAdditionalInterestIds(meetup.additionalInterestIds ?? []);
    setCoverDraft(COVER_DRAFT_UNCHANGED);
    setCoverSaveError(null);


    // Hydrate location editor from persisted snapshot.
    setLocCityId(meetup.location?.cityId ?? null);
    setLocCityName(meetup.location?.cityName ?? null);
    setLocPlaceId(
      meetup.communityPlaceId
        ? meetup.communityPlaceId
        : meetup.location?.locationSource === "custom_location"
          ? CUSTOM_PLACE_ID
          : null,
    );
    const isCustomSnapshot = meetup.location?.locationSource === "custom_location";
    setLocCustom({
      name: isCustomSnapshot ? meetup.location?.locationName ?? "" : "",
      address: isCustomSnapshot ? meetup.location?.address ?? "" : "",
      latitude: isCustomSnapshot ? meetup.location?.latitude ?? null : null,
      longitude: isCustomSnapshot ? meetup.location?.longitude ?? null : null,
      googlePlaceId: null,
      googleMapsUrl: null,
    });

  }, [meetup?.id]);

  // WO-124 — approved interest taxonomy, same source as onboarding/profile.
  const interestCatalogue = useQuery({
    queryKey: ["interest-catalogue"],
    queryFn: fetchInterestCatalogue,
    staleTime: 60 * 60 * 1000,
  });

  const interestOptions = interestCatalogue.data ?? [];

  /**
   * DEF-134-02 — older Meetups can open with no usable Main category. Once the
   * catalogue is available, recover one from the legacy compatibility value when
   * the mapping is unambiguous; otherwise flag the picker for host recovery.
   * Runs once per Meetup so it never overwrites a host's own choice.
   */
  const interestRecoveredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!meetup || interestOptions.length === 0) return;
    if (interestRecoveredRef.current === meetup.id) return;
    interestRecoveredRef.current = meetup.id;
    const recovered = recoverPrimaryInterest(
      meetup.primaryInterestId,
      meetup.category,
      interestOptions,
    );
    setPrimaryInterestId(recovered.primaryId);
  }, [meetup?.id, interestOptions.length]);

  const primaryInterestSelectable =
    !!primaryInterestId && interestOptions.some((o) => o.id === primaryInterestId);
  const needsInterestRecovery =
    !interestCatalogue.isLoading && interestOptions.length > 0 && !primaryInterestSelectable;


  const placesQuery = useQuery({
    queryKey: ["manage-places", locCityId],
    enabled: !!locCityId,
    queryFn: () => fetchPublishedCommunityPlaces(locCityId!),
    staleTime: 60_000,
  });

  // WO-053: the linked Community Place may have gone non-operational after the
  // Meetup was created. The Meetup is never auto-cancelled — the host is asked
  // to move it. Read directly by id so closed places are still resolvable.
  const linkedPlaceQuery = useQuery({
    queryKey: ["manage-linked-place", meetup?.communityPlaceId],
    enabled: !!meetup?.communityPlaceId,
    queryFn: () => fetchCommunityPlaceById(meetup!.communityPlaceId as string),
    staleTime: 30_000,
  });
  const linkedPlaceUnavailable =
    !!linkedPlaceQuery.data &&
    (linkedPlaceQuery.data.maintenanceStatus ?? "operational") !== "operational";



  // Realtime: keep summary + attendee list in sync with backend.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`manage-meetup:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance", filter: `meetup_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["managed-attendees", id] }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meetups", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["managed-meetup", id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);


  const activeAttendeeCount = useMemo(
    () => attendeesQuery.data?.length ?? 0,
    [attendeesQuery.data],
  );

  const capacityBelowAttendance = capacity < activeAttendeeCount;
  const startsInPast = useMemo(() => {
    if (!date || !startTime) return false;
    const d = new Date(`${date}T${startTime}:00`);
    return d.getTime() < Date.now();
  }, [date, startTime]);
  // WO-112: blank end time is valid; an end at or before the start is not.
  const endTimeError =
    endTime !== "" && endTime <= startTime
      ? "End time must be after the start time."
      : null;
  const canSave =
    title.trim().length > 0 &&
    !!date &&
    !!startTime &&
    !endTimeError &&
    capacity >= 1 &&
    primaryInterestSelectable &&
    !capacityBelowAttendance &&
    !startsInPast &&
    !saving &&
    meetup?.status === "upcoming";


  // Attendee removal dialog
  const [removeTarget, setRemoveTarget] = useState<ManagedAttendee | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removing, setRemoving] = useState(false);

  // Cancellation dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);


  // ---- Location editor derivations (must stay above early returns so the
  // hook order is stable across loading / not-found / not-host renders) ----
  const homeCity = contextQuery.data?.home_city ?? null;
  const selectedCity = contextQuery.data?.selected_city ?? null;
  const isEnded = useMemo(() => {
    if (!meetup) return false;
    const end = new Date(`${meetup.date}T${meetup.endTime || meetup.startTime}:00`);
    return end.getTime() <= Date.now();
  }, [meetup?.date, meetup?.endTime, meetup?.startTime]);
  const locIsCustom = locPlaceId === CUSTOM_PLACE_ID;
  const locSelectedPlace: CommunityPlace | undefined = (placesQuery.data ?? []).find(
    (p) => p.id === locPlaceId,
  );
  // Coordinates only ever arrive from a Google Places selection.
  const locCoordsValid =
    (locCustom.latitude === null && locCustom.longitude === null) ||
    (locCustom.latitude !== null && locCustom.longitude !== null);
  const locResolved = useMemo(() => {
    if (!locCityId || !meetup) return null;
    if (locIsCustom) {
      const lat = locCustom.latitude;
      const lng = locCustom.longitude;

      return {
        cityId: locCityId,
        cityName: locCityName,
        communityPlaceId: null as string | null,
        locationName: locCustom.name.trim(),
        address: locCustom.address.trim() || null,

        neighborhood: null as string | null,
        latitude: lat,
        longitude: lng,
        timezone:
          selectedCity?.id === locCityId ? selectedCity?.timezone ?? null
          : homeCity?.id === locCityId ? homeCity?.timezone ?? null
          : meetup.location?.timezone ?? null,
        locationSource: "custom_location" as const,
      };
    }
    if (!locSelectedPlace) return null;
    return {
      cityId: locCityId,
      cityName: locSelectedPlace.cityName ?? locCityName,
      communityPlaceId: locSelectedPlace.id,
      locationName: locSelectedPlace.name,
      address: locSelectedPlace.address ?? null,
      neighborhood: locSelectedPlace.neighborhood ?? null,
      // WO-061A: coordinates for a Community Place are filled in server-side.
      latitude: null,
      longitude: null,
      timezone:
        locSelectedPlace.timezone ??
        (selectedCity?.id === locCityId ? selectedCity?.timezone : null) ??
        (homeCity?.id === locCityId ? homeCity?.timezone : null) ??
        meetup.location?.timezone ?? null,
      locationSource: "community_place" as const,
    };
  }, [
    locCityId, locCityName, locIsCustom, locCustom,
    locSelectedPlace, selectedCity, homeCity, meetup,
  ]);



  if (authLoading || meetupQuery.isPending) {
    return (
      <div className="flex flex-col min-h-dvh items-center justify-center text-sm text-charcoal-muted">
        Loading…
      </div>
    );
  }

  if (!meetup) {
    return (
      <div className="p-8 text-center">
        <p className="text-charcoal font-medium">Meetup not found.</p>
        <button onClick={() => safeBack(navigate, "/plans")} className="mt-4 text-sm text-primary">
          Go back
        </button>
      </div>
    );
  }

  if (!isHost) {
    return (
      <div className="p-8 text-center flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-soft-green flex items-center justify-center text-primary">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <p className="text-charcoal font-medium">Only the host can manage this Meetup.</p>
        <Link to={`/meetup/${meetup.id}`} className="text-sm text-primary font-semibold">
          Back to Meetup
        </Link>
      </div>
    );
  }

  const isCancelled = meetup.status === "cancelled";
  // `fetchMeetupById` already maps a NULL cover to the stock fallback, so the
  // fallback URL is exactly what "this Meetup has no custom cover" looks like.
  const currentCustomCover =
    meetup.coverImageUrl && meetup.coverImageUrl !== FALLBACK_COVER
      ? meetup.coverImageUrl
      : null;
  const coverPreview = previewCover(coverDraft, currentCustomCover);


  // WO-063 — completion is decided by the server; the UI only mirrors it.
  const lifecycle = lifecycleQuery.data;
  const isCompleted = !!lifecycle?.is_completed;
  const canComplete = !!lifecycle?.can_complete;
  const completionBlocked =
    lifecycle && lifecycle.is_host && lifecycle.has_ended && !isCompleted && !canComplete
      ? blockedReasonCopy(lifecycle.blocked_reason)
      : null;
  const locked = isCancelled || isCompleted;

  async function handleComplete() {
    if (!meetup) return;
    setCompleting(true);
    try {
      const res = await completeHostedMeetup(meetup.id);
      toast({
        title:
          res.result === "already_completed"
            ? "Already completed"
            : "Meetup completed",
        description:
          "It now counts toward Hosting Meetups in your Community Impact.",
      });
      setCompleteOpen(false);
      await qc.invalidateQueries({ queryKey: ["meetup-lifecycle", meetup.id] });
      await qc.invalidateQueries({ queryKey: ["managed-meetup", meetup.id] });
      await qc.invalidateQueries({ queryKey: ["meetup-membership", meetup.id] });
      await qc.invalidateQueries({ queryKey: ["my-community-impact"] });
      await qc.invalidateQueries({ queryKey: ["community-impact"] });
      await qc.invalidateQueries({ queryKey: ["my-plans"] });
    } catch (e: any) {
      logAnalyticsEvent("meetup_completion_blocked", { reason: "rpc_error" });
      toast({
        title: "Couldn't complete Meetup",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCompleting(false);
    }
  }


  async function handleSave() {
    // WO-133 — `saving` also guards against a double-submit issuing two
    // conflicting cover mutations; `canSave` is false while it is true.
    if (!meetup || !canSave) return;
    setSaving(true);
    setCoverSaveError(null);
    // Snapshot the staged cover so a late picker result can't change what we
    // are about to persist mid-flight.
    const cover = resolveCoverUpdate(coverDraft);
    try {
      await updateHostedMeetup({
        meetupId: meetup.id,
        title: title.trim(),
        description: description.trim(),
        date,
        startTime,
        endTime: endTime === "" ? null : endTime,
        capacity,
        communityPlaceId: meetup.communityPlaceId || null,
        // Location is edited separately via update_meetup_location — pass current snapshot unchanged.
        customLocationName: meetup.customLocation?.name ?? null,
        customLocationAddress: meetup.customLocation?.address ?? null,
        // Cover: null + clearCover=false means "leave the current cover as is".
        coverImageUrl: cover.dirty ? cover.coverImageUrl : null,
        clearCover: cover.clearCover,
        primaryInterestId,
        additionalInterestIds,
      });
      toast({
        title: cover.clearCover
          ? "Meetup cover removed"
          : cover.dirty
            ? "Meetup cover updated"
            : "Meetup updated",
        description: "Attendees will be notified of meaningful changes.",
      });
      setCoverDraft(COVER_DRAFT_UNCHANGED);
      // WO-133 — every surface that renders a Meetup cover must drop its cache
      // so the old image can never linger: Manage summary + member detail
      // (managed-meetup / meetup-membership), Today, Community, My Plans,
      // invitations and search results.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["managed-meetup", meetup.id] }),
        qc.invalidateQueries({ queryKey: ["meetup-membership", meetup.id] }),
        qc.invalidateQueries({ queryKey: ["today-experience"] }),
        qc.invalidateQueries({ queryKey: ["community-feed"] }),
        qc.invalidateQueries({ queryKey: ["my-plans"] }),
        qc.invalidateQueries({ queryKey: ["meetup-invitations"] }),
        qc.invalidateQueries({ queryKey: ["search"] }),
      ]);
    } catch (e: any) {
      // The row update is atomic, so a failure leaves the published cover
      // exactly as it was. The staged draft is kept so the host doesn't lose
      // their pick — and no unrelated field is reset.
      if (cover.dirty) setCoverSaveError(coverSaveErrorMessage(e));
      toast({
        title: "Couldn't update Meetup",
        description: cover.dirty
          ? coverSaveErrorMessage(e)
          : (e?.message ?? "Please try again."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }


  async function handleRemoveConfirm() {
    if (!meetup || !removeTarget) return;
    setRemoving(true);
    try {
      await removeMeetupAttendee(meetup.id, removeTarget.profileId, removeReason.trim());
      toast({
        title: "Attendee removed",
        description: `${removeTarget.displayName || "The attendee"} has been notified privately.`,
      });
      setRemoveTarget(null);
      setRemoveReason("");
      await qc.invalidateQueries({ queryKey: ["managed-attendees", meetup.id] });
    } catch (e: any) {
      toast({
        title: "Couldn't remove attendee",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  }

  async function handleCancelConfirm() {
    if (!meetup) return;
    setCancelling(true);
    try {
      await cancelMeetup(meetup.id, cancelReason.trim());
      toast({
        title: "Meetup cancelled",
        description: "Attendees have been notified.",
      });
      setCancelOpen(false);
      setCancelReason("");
      await qc.invalidateQueries({ queryKey: ["managed-meetup", meetup.id] });
      navigate(`/meetup/${meetup.id}`);
    } catch (e: any) {
      toast({
        title: "Couldn't cancel Meetup",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  }

  // ---- Location editor ---------------------------------------------------


  const canSaveLocation =
    !!locResolved &&
    locResolved.locationName.length > 0 &&
    locCoordsValid &&
    !isEnded &&
    !isCancelled &&
    !locSaving;

  const timezoneWillChange =
    !!locResolved && !!meetup?.location?.timezone &&
    (locResolved.timezone ?? "") !== (meetup.location.timezone ?? "");

  async function handleLocationSave() {
    if (!meetup || !locResolved || !canSaveLocation) return;
    setLocSaving(true);
    try {
      const res = await updateMeetupLocation({
        meetupId: meetup.id,
        cityId: locResolved.cityId,
        communityPlaceId: locResolved.communityPlaceId,
        locationName: locResolved.locationName,
        address: locResolved.address,
        neighborhood: locResolved.neighborhood,
        latitude: locResolved.latitude,
        longitude: locResolved.longitude,
        timezone: locResolved.timezone,
        locationSource: locResolved.locationSource,
      });
      // WO-123: keep the stored Google reference in step with the new location.
      try {
        await setMeetupGoogleLocationMeta(
          meetup.id,
          locIsCustom ? locCustom.googlePlaceId : null,
          locIsCustom ? locCustom.googleMapsUrl : null,
        );
      } catch {
        /* ignore — cosmetic metadata only */
      }

      // Copy is driven by notifications_inserted (not recipients_count), so we
      // never claim attendees were notified when zero notifications landed.
      if (res.notifications_inserted > 0) {
        toast({
          title: "Location updated",
          description: `${res.notifications_inserted} ${
            res.notifications_inserted === 1 ? "attendee was" : "attendees were"
          } notified.`,
        });
      } else if (res.notified ?? res.meaningful_change) {
        toast({ title: "Location updated" });
      } else {
        toast({ title: "Location details updated" });
      }

      setLocConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ["managed-meetup", meetup.id] });
      await qc.invalidateQueries({ queryKey: ["meetup-membership", meetup.id] });
      await qc.invalidateQueries({ queryKey: ["today"] });
      await qc.invalidateQueries({ queryKey: ["community"] });
    } catch (e: any) {
      toast({
        title: "Couldn't update location",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLocSaving(false);
    }
  }


  return (
    <>
      <AppHeader
        title="Manage Meetup"
        subtitle={isCancelled ? "This Meetup has been cancelled." : "Keep everyone in the loop."}
        left={
          <BackButton fallback="/plans" />
        }
      />

      <div className="px-5 py-6 pb-32 space-y-8">
        {/* Summary */}
        <section className="rounded-card border border-border bg-card p-4 flex gap-4">
          <img
            src={coverPreview ?? FALLBACK_COVER}
            alt=""
            className="w-20 h-20 rounded-control object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-charcoal truncate">{meetup.title}</div>
            <div className="mt-1 text-xs text-charcoal-muted flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {meetup.date} · {meetup.startTime}
            </div>
            <div className="mt-1 text-xs text-charcoal-muted flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {activeAttendeeCount} / {meetup.capacity} attending
            </div>
            {isCancelled && (
              <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                <Ban className="w-3.5 h-3.5" /> Cancelled
              </div>
            )}
          </div>
        </section>

        {/* WO-144 — invite connected Veggies to this Meetup. */}
        {!locked && !isEnded && (
          <section className="rounded-card border border-border bg-card p-4">
            <h2 className="font-semibold text-charcoal">Invite Veggies</h2>
            <p className="mt-1 text-xs text-charcoal-muted">
              Invite Veggies from your network. They'll get a notification and can join
              from the Meetup.
            </p>
            <SecondaryButton
              fullWidth
              className="mt-3"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="w-4 h-4" />
              Invite Veggies
            </SecondaryButton>
          </section>
        )}



        {/* Edit form (disabled if cancelled) */}
        {/* WO-063 — completion state / Finish Meetup */}
        {isCompleted ? (
          <section className="rounded-card border border-primary/25 bg-primary/5 p-4">
            <h2 className="font-semibold text-charcoal flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              Meetup completed
            </h2>
            <p className="mt-1 text-xs text-charcoal-muted">
              This Meetup is final and counts toward Hosting Meetups in your Community Impact.
              Details can no longer be edited.
            </p>
          </section>
        ) : lifecycle?.is_host && lifecycle.has_ended && !isCancelled ? (
          <section className="rounded-card border border-border bg-card p-4">
            <h2 className="font-semibold text-charcoal">Finish this Meetup</h2>
            <p className="mt-1 text-xs text-charcoal-muted">
              {canComplete
                ? "Marking it complete makes it final and counts it toward Hosting Meetups in your Community Impact. It won't create or change any connections."
                : completionBlocked}
            </p>
            <PrimaryButton
              fullWidth
              className="mt-3"
              disabled={!canComplete || completing}
              onClick={() => setCompleteOpen(true)}
            >
              {completing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Finish Meetup
            </PrimaryButton>
          </section>
        ) : null}

        {/* Edit form (disabled once the Meetup has ended, been completed or cancelled) */}
        <section
          className={cn(
            "space-y-6",
            (locked || isEnded) && "opacity-60 pointer-events-none",
          )}
        >

          {/* WO-133 — Meetup cover. Staged: saved with the rest of the form. */}
          <MeetupCoverEditor
            currentCover={currentCustomCover}
            draft={coverDraft}
            onDraftChange={(next) => {
              setCoverSaveError(null);
              setCoverDraft(next);
            }}
            disabled={locked || isEnded || saving}
            saveError={coverSaveError}
          />



          <div>
            <FieldLabel>Title</FieldLabel>
            <input aria-label="Title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-control border border-border bg-card px-4 py-3 text-base text-charcoal"
              placeholder="What should attendees know?"
            />
          </div>

          {/* WO-126 — the canonical taxonomy is the only classification UI */}
          <div>
            <FieldLabel>Category</FieldLabel>
            <p className="mb-3 text-xs text-charcoal-muted">
              Pick one main category, plus up to two optional extras. We use these to
              suggest your Meetup to Veggies with matching interests.
            </p>

            <MeetupInterestPicker
              options={interestOptions}
              loading={interestCatalogue.isLoading}
              recovery={needsInterestRecovery}
              primaryId={primaryInterestId}
              additionalIds={additionalInterestIds}
              onPrimaryChange={setPrimaryInterestId}
              onAdditionalChange={setAdditionalInterestIds}
              suggestFrom={`${title} ${description}`}
            />
          </div>


          {/* WO-112B: wraps at large text sizes so the native date/time inputs
              are never clipped. */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 basis-[10rem] min-w-0">

              <FieldLabel>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-4 h-4" aria-hidden="true" /> Date
                </span>
              </FieldLabel>
              <input aria-label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-12 rounded-control border border-border bg-card px-3 text-base text-charcoal"
              />
            </div>
            <div className="flex-1 basis-[10rem] min-w-0">

              <FieldLabel>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-4 h-4" aria-hidden="true" /> Start time
                </span>
              </FieldLabel>
              <input
                aria-label="Start time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full h-12 rounded-control border border-border bg-card px-3 text-base text-charcoal"
              />
            </div>
          </div>
          {/* WO-112 — optional end time; blank means no specified ending time. */}
          <div>
            <label
              htmlFor="manage-end-time"
              className="block text-sm font-semibold text-charcoal mb-2"
            >
              <span className="inline-flex items-center gap-1">
                <Clock className="w-4 h-4" aria-hidden="true" /> End time{" "}
                <span className="font-normal text-charcoal-muted">(optional)</span>
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="manage-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                aria-invalid={endTimeError ? true : undefined}
                aria-describedby={
                  endTimeError ? "manage-end-time-error" : "manage-end-time-hint"
                }
                className="w-full h-12 rounded-control border border-border bg-card px-3 text-base text-charcoal"
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
              <p id="manage-end-time-error" className="mt-1.5 text-xs text-destructive">
                {endTimeError}
              </p>
            ) : (
              <p id="manage-end-time-hint" className="mt-1.5 text-xs text-charcoal-muted">
                Leave blank if there’s no set end time.
              </p>
            )}
          </div>
          {startsInPast && !locked && !isEnded && (
            <p className="text-xs text-destructive">Start time is in the past.</p>
          )}



          <div>
            <FieldLabel>
              <span className="inline-flex items-center gap-1">
                <Users className="w-4 h-4" /> Capacity
              </span>
            </FieldLabel>
            <input
              aria-label="Group size"
              type="number"
              min={Math.max(1, activeAttendeeCount)}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 0))}
              className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal"
            />
            <p className="mt-1.5 text-xs text-charcoal-muted">
              Minimum {Math.max(1, activeAttendeeCount)} — matches people already attending.
            </p>
            {capacityBelowAttendance && !locked && !isEnded && (
              <p className="mt-1 text-xs text-destructive">
                Capacity can't be lower than current attendance.
              </p>
            )}

          </div>

          <p className="text-[11px] text-charcoal-muted">
            Location is edited separately below so attendees are notified.
          </p>


          <PrimaryButton fullWidth disabled={!canSave} onClick={handleSave}>
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save changes"}
          </PrimaryButton>
        </section>

        {!isCompleted && placeContextQuery.data?.linked && placeContextQuery.data.host && (
          <MeetupLocationStatus
            meetupId={id!}
            context={placeContextQuery.data}
            onUpdated={() => {
              void qc.invalidateQueries({ queryKey: ["meetup-place-context", id] });
              void qc.invalidateQueries({ queryKey: ["managed-meetup", id] });
              void qc.invalidateQueries({ queryKey: ["meetup-membership", id] });
            }}
          />
        )}

        {/* Location editor — writes through update_meetup_location (fires notifications). */}
        <section className={cn("space-y-4", (locked || isEnded) && "opacity-60 pointer-events-none")}>
          <div>
            <h2 className="text-lg font-semibold text-charcoal">Location</h2>
            <p className="text-xs text-charcoal-muted mt-0.5">
              Changing the city, place, or address notifies confirmed attendees.
            </p>
          </div>

          {linkedPlaceUnavailable && (
            <div
              role="status"
              className="rounded-control border border-warning/50 bg-warning/10 p-3 text-xs text-charcoal min-w-0 [overflow-wrap:anywhere]"
            >
              <span className="font-semibold block">Location needs attention</span>
              {linkedPlaceQuery.data?.name} is no longer available as a Community Place. This
              Meetup is still scheduled — choose a new place or a custom location below.
              Attendees are notified when you save the new location.
            </div>
          )}

          {meetup.location?.isInferred && (
            <div className="rounded-control border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
              This Meetup's location was inferred from the city. Confirm a real place or custom
              location so people know exactly where to go.
            </div>
          )}

          <div>
            <FieldLabel>City</FieldLabel>
            <CitySelector
              variant="block"
              value={locCityId}
              triggerLabel={locCityName ?? "Choose city"}
              onSelect={(id, name) => {
                setLocCityId(id);
                setLocCityName(name);
                if (locPlaceId !== CUSTOM_PLACE_ID) setLocPlaceId(null);
              }}
            />
          </div>


          <div>
            <FieldLabel>Place</FieldLabel>
            {!locCityId ? (
              <p className="text-xs text-charcoal-muted">Pick a city first.</p>
            ) : (
              <CommunityPlacePicker
                places={placesQuery.data ?? []}
                loading={placesQuery.isLoading}
                errored={placesQuery.isError}
                onRetry={() => placesQuery.refetch()}
                selectedPlaceId={locIsCustom ? null : locPlaceId}
                onSelect={(p) => setLocPlaceId(p.id)}
                onUseCustom={() => setLocPlaceId(CUSTOM_PLACE_ID)}
                onSuggestPlace={() => navigate("/community/places/suggest")}
                onViewPlace={(pid) =>
                  window.open(`/place/${pid}`, "_blank", "noopener,noreferrer")
                }
              />
            )}
            {locCityId && (
              <button
                type="button"
                onClick={() => setLocPlaceId(CUSTOM_PLACE_ID)}
                className={cn(
                  "mt-2 w-full text-left rounded-control border px-3 py-2.5 flex items-center gap-2",
                  locIsCustom
                    ? "border-primary bg-primary/5"
                    : "border-dashed border-border bg-card hover:bg-muted/40",
                )}
              >
                <MapPin className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-charcoal">Custom location</span>
              </button>
            )}
          </div>


          {locIsCustom && (
            <CustomLocationSearch
              value={locCustom}
              onChange={setLocCustom}
              region={
                selectedCity?.id === locCityId
                  ? selectedCity?.country_code
                  : homeCity?.id === locCityId
                    ? homeCity?.country_code
                    : null
              }
              onEvent={(event, detail) =>
                logAnalyticsEvent(`meetup_custom_location_${event}`, detail ?? {})
              }
            />
          )}

          {locIsCustom && locCustom.name.trim().length === 0 && (
            <p role="alert" className="text-xs text-destructive">
              Add a location name before updating the location.
            </p>
          )}


          <PrimaryButton
            fullWidth
            disabled={!canSaveLocation}
            onClick={() => setLocConfirmOpen(true)}
          >
            <Save className="w-4 h-4" />
            Update location
          </PrimaryButton>
          {isEnded && (
            <p className="text-xs text-charcoal-muted">
              This Meetup has ended — location can no longer be changed.
            </p>
          )}
        </section>


        {/* Attendees */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold text-charcoal">Attendees</h2>
            <span className="text-xs text-charcoal-muted">
              {activeAttendeeCount} confirmed
            </span>
          </div>
          {attendeesQuery.isPending ? (
            <p className="text-sm text-charcoal-muted">Loading attendees…</p>
          ) : activeAttendeeCount === 0 ? (
            <p className="text-sm text-charcoal-muted">No one has joined yet.</p>
          ) : (
            <ul className="space-y-2">
              {attendeesQuery.data!.map((a) => {
                const isTheHost = a.profileId === meetup.hostId;
                return (
                  <li
                    key={a.attendanceId}
                    className="flex items-center gap-3 p-3 rounded-card border border-border bg-card"
                  >
                    <UserAvatar name={a.displayName} src={a.avatarUrl ?? undefined} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-charcoal truncate">
                        {a.displayName || "Veggie"}
                      </div>
                      <div className="text-xs text-charcoal-muted">
                        {isTheHost ? "Host" : "Attendee"}
                      </div>
                    </div>
                    {!isTheHost && !locked && (
                      <button
                        onClick={() => {
                          setRemoveTarget(a);
                          setRemoveReason("");
                        }}
                        className="text-xs font-semibold text-destructive inline-flex items-center gap-1 px-2 py-1 rounded-control hover:bg-destructive/10"
                      >
                        <UserMinus className="w-3.5 h-3.5" /> Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Danger zone */}
        {!locked && (
          <section className="rounded-card border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="font-semibold text-charcoal flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Cancel this Meetup
            </h3>
            <p className="mt-1 text-xs text-charcoal-muted">
              This can't be undone. All attendees will be notified.
            </p>
            <SecondaryButton
              fullWidth
              onClick={() => setCancelOpen(true)}
              className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Ban className="w-4 h-4" /> Cancel Meetup
            </SecondaryButton>
          </section>
        )}
      </div>

      {/* Remove attendee dialog */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRemoveTarget(null);
            setRemoveReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.displayName || "attendee"}?</DialogTitle>
            <DialogDescription>
              They'll be quietly notified they were removed. Your reason is private and only
              stored for your records.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Reason (optional, private)"
            className="mt-2"
          />
          <div className="mt-1 text-[11px] text-charcoal-muted text-right">
            {removeReason.length}/300
          </div>
          <DialogFooter>
            <SecondaryButton onClick={() => setRemoveTarget(null)} disabled={removing}>
              Keep them
            </SecondaryButton>
            <PrimaryButton
              onClick={handleRemoveConfirm}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Removing…
                </>
              ) : (
                <>
                  <UserMinus className="w-4 h-4" />
                  Remove attendee
                </>
              )}
            </PrimaryButton>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* WO-063 — completion confirmation */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finish this Meetup?</DialogTitle>
            <DialogDescription>
              This is final and can't be undone. The Meetup becomes read-only and counts once
              toward Hosting Meetups in your Community Impact. It won't create Verified
              Connections or Community Place support.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <SecondaryButton onClick={() => setCompleteOpen(false)} disabled={completing}>
              Not yet
            </SecondaryButton>
            <PrimaryButton onClick={handleComplete} disabled={completing}>
              {completing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Completing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Finish Meetup
                </>
              )}
            </PrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel meetup dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this Meetup?</DialogTitle>
            <DialogDescription>
              Everyone attending will receive a notification. Please share a short reason so
              attendees understand what happened.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Why is this Meetup being cancelled?"
            className="mt-2"
          />
          <div className="mt-1 text-[11px] text-charcoal-muted text-right">
            {cancelReason.length}/300
          </div>
          <DialogFooter>
            <SecondaryButton onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep Meetup
            </SecondaryButton>
            <PrimaryButton
              onClick={handleCancelConfirm}
              disabled={cancelling || cancelReason.trim().length === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cancelling…
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4" />
                  Cancel Meetup
                </>
              )}
            </PrimaryButton>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* Location change confirmation. */}
      <Dialog open={locConfirmOpen} onOpenChange={setLocConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Meetup location?</DialogTitle>
            <DialogDescription>
              {locResolved ? (
                <>
                  New location:{" "}
                  <span className="font-medium text-charcoal">
                    {locResolved.locationName}
                  </span>
                  {locResolved.address ? ` · ${locResolved.address}` : ""} ·{" "}
                  {locResolved.cityName ?? "City"}. Confirmed attendees will be notified
                  {timezoneWillChange
                    ? " and the Meetup's timezone will change."
                    : "."}
                </>
              ) : (
                "Choose a city and place first."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <SecondaryButton onClick={() => setLocConfirmOpen(false)} disabled={locSaving}>
              Cancel
            </SecondaryButton>
            <PrimaryButton onClick={handleLocationSave} disabled={!canSaveLocation}>
              {locSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Updating…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Update
                </>
              )}
            </PrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>

  );
}
