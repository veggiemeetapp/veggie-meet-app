import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, MapPin, Sticker } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/app";
import { checkInBlockedCopy, checkInToMeetup, fetchMyAttendance } from "@/lib/meetupAttendance";
import { checkInToCommunityPlace, type CheckInReason } from "@/lib/placeVisits";
import { memberSafeMessage } from "@/lib/errors";
import { logAnalyticsEvent } from "@/lib/analytics";
import { fireConfetti } from "@/lib/celebrations";
import { useState } from "react";

/**
 * WO-063 — self check-in for a member who has joined the Meetup.
 *
 * Presentation only: every rule (membership, timing window, completion)
 * is enforced by `check_in_to_meetup` on the server.
 *
 * Collection (2026-11-22): when the Meetup is held at a Community Place, a
 * successful Meetup check-in also attempts the GPS place check-in, because
 * stickers and "Places Supported" only count verified place visits. If the
 * device isn't within range (or location is off) the member keeps the Meetup
 * check-in and sees a "collect your sticker" link to try again at the place.
 */
export function MeetupCheckInButton({
  meetupId,
  profileId,
  startsAt,
  endsAt,
  communityPlaceId = null,
  placeName = null,
}: {
  meetupId: string;
  profileId: string;
  /** Local ISO-ish `YYYY-MM-DDTHH:mm` for presentation gating only. */
  startsAt?: string;
  endsAt?: string;
  /** Community Place the Meetup is held at, when any. */
  communityPlaceId?: string | null;
  placeName?: string | null;
}) {
  const qc = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["my-attendance", meetupId, profileId],
    queryFn: () => fetchMyAttendance(meetupId, profileId),
    staleTime: 0,
  });

  const placeQ = useQuery({
    queryKey: ["place-checkin-state", communityPlaceId ?? ""],
    enabled: !!communityPlaceId,
    queryFn: async () => {
      const { fetchPlaceCheckInState } = await import("@/lib/placeVisits");
      return fetchPlaceCheckInState(communityPlaceId!);
    },
    staleTime: 10_000,
  });

  const collectSticker = useMutation({
    mutationFn: async () => {
      if (!communityPlaceId) return null;
      logAnalyticsEvent("community_place_check_in_started", { place_id: communityPlaceId });
      return checkInToCommunityPlace(communityPlaceId);
    },
    onSuccess: (res) => {
      if (!res || !communityPlaceId) return;
      if (res.ok) {
        logAnalyticsEvent("community_place_check_in_succeeded", {
          place_id: communityPlaceId,
          verification_method: "device_location",
          is_first_visit_to_place: !!res.isFirstVisitToPlace,
        });
        fireConfetti({ origin: { x: 0.5, y: 0.5 }, count: 60 });
        toast.success(
          res.isFirstVisitToPlace
            ? `Sticker collected: ${placeName ?? "this place"} is now in your collection.`
            : `Visit verified at ${placeName ?? "this place"}. Your sticker levelled up a step.`,
        );
      } else {
        logAnalyticsEvent("community_place_check_in_failed", {
          place_id: communityPlaceId,
          safe_reason_code: res.reason,
        });
        if (res.reason !== "already_checked_in") {
          toast(stickerHint(res.reason, placeName), { description: "You're still checked in to the Meetup." });
        }
      }
      qc.invalidateQueries({ queryKey: ["place-checkin-state", communityPlaceId] });
      qc.invalidateQueries({ queryKey: ["place-detail", communityPlaceId] });
      qc.invalidateQueries({ queryKey: ["me-impact-overview"] });
      qc.invalidateQueries({ queryKey: ["impact-overview"] });
      qc.invalidateQueries({ queryKey: ["collection"] });
    },
  });

  const [justArrived, setJustArrived] = useState(false);
  const mutation = useMutation({
    mutationFn: () => checkInToMeetup(meetupId),
    onSuccess: (res) => {
      if (res.result === "blocked") {
        toast.error(checkInBlockedCopy(res.reason));
      } else if (res.result === "already_checked_in") {
        toast.success("You're already checked in.");
      } else {
        setJustArrived(true);
        toast.success("You're marked as here for this Meetup.");
      }
      qc.invalidateQueries({ queryKey: ["my-attendance", meetupId] });
      qc.invalidateQueries({ queryKey: ["meetup-lifecycle", meetupId] });
      qc.invalidateQueries({ queryKey: ["managed-attendees", meetupId] });
      // One tap, two check-ins: the place visit is what earns the sticker.
      if (res.result !== "blocked" && communityPlaceId && !placeQ.data?.checkedIn) {
        collectSticker.mutate();
      }
    },
    onError: (e: Error) => toast.error(memberSafeMessage(e)),
  });

  if (isPending) return null;

  const stickerRow =
    communityPlaceId && placeQ.data ? (
      placeQ.data.checkedIn ? (
        <p className="text-center text-xs text-primary inline-flex items-center justify-center gap-1 w-full">
          <Sticker className="w-3.5 h-3.5" aria-hidden /> Sticker collected at {placeName ?? "this place"}
        </p>
      ) : (
        <div className="text-center text-xs text-charcoal-muted">
          <button
            type="button"
            onClick={() => collectSticker.mutate()}
            disabled={collectSticker.isPending}
            className="inline-flex items-center gap-1 font-semibold text-primary"
          >
            <Sticker className="w-3.5 h-3.5" aria-hidden />
            {collectSticker.isPending ? "Checking your location…" : `Collect your sticker at ${placeName ?? "the place"}`}
          </button>
          <span className="block">
            Needs your location once, within 150 m of the place.{" "}
            <Link to={`/place/${communityPlaceId}`} className="underline">
              Open place
            </Link>
          </span>
        </div>
      )
    ) : null;

  if (data?.status === "checked_in" || data?.status === "attended") {
    return (
      <div className="space-y-2">
        <div
          className={`flex items-center justify-center gap-2 text-sm font-semibold text-primary ${justArrived ? "motion-safe:animate-pop" : ""}`}
          aria-live="polite"
        >
          <span className="relative inline-flex">
            {justArrived && <span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ring-ping" aria-hidden />}
            <CheckCircle2 className="w-4 h-4 relative" />
          </span>
          You're here
        </div>
        {stickerRow}
      </div>
    );
  }

  if (data?.status !== "joined") return null;

  // Presentation gating only — the server still decides every transition.
  const now = Date.now();
  const startMs = startsAt ? new Date(startsAt).getTime() : NaN;
  const endMs = endsAt ? new Date(endsAt).getTime() : NaN;
  if (!Number.isNaN(startMs) && now < startMs - 60 * 60 * 1000) {
    return (
      <p className="text-center text-xs text-charcoal-muted">
        “I'm here” opens an hour before the Meetup starts.
      </p>
    );
  }
  if (!Number.isNaN(endMs) && now > endMs + 4 * 60 * 60 * 1000) return null;

  return (
    <div className="space-y-1.5">
      <PrimaryButton
        fullWidth
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || collectSticker.isPending}
      >
        <MapPin className="w-4 h-4" />
        {mutation.isPending
          ? "Marking you here…"
          : collectSticker.isPending
            ? "Collecting your sticker…"
            : "I'm here"}
      </PrimaryButton>
      {communityPlaceId && (
        <p className="text-center text-[11px] text-charcoal-muted">
          Also collects the {placeName ?? "place"} sticker when you're within 150 m.
        </p>
      )}
    </div>
  );
}

function stickerHint(reason: CheckInReason, placeName: string | null): string {
  const p = placeName ?? "the place";
  switch (reason) {
    case "outside_radius":
      return `Not close enough to ${p} yet. Collect your sticker when you're there.`;
    case "accuracy_too_low":
      return `Location wasn't precise enough. Try collecting your sticker again at ${p}.`;
    case "location_permission_denied":
      return "Allow location access to collect place stickers.";
    case "place_unavailable":
      return `Check-ins are paused at ${p} right now.`;
    default:
      return `We couldn't verify your location at ${p}. Try again from the place page.`;
  }
}
