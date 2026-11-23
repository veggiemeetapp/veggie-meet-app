import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Navigation } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { Sticker } from "lucide-react";
import { PrimaryButton, SecondaryButton, TertiaryButton } from "@/components/app";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  checkInToCommunityPlace,
  type CheckInReason,
} from "@/lib/placeVisits";
import { useMyPlaceSticker } from "@/hooks/useCollection";
import { PlaceSticker } from "@/components/collection/PlaceSticker";
import { STICKER_LEVEL_LABEL, STICKER_THRESHOLDS, stickerHue } from "@/lib/collection";
import { fireConfetti, stickerConfettiColors } from "@/lib/celebrations";

/**
 * Collection reward shown after a verified visit: the place's sticker at its
 * new level and how many visits remain for the next one. Reads its own RPC
 * so the check-in call itself is untouched.
 */
function StickerReward({ placeId, placeName }: { placeId: string; placeName: string }) {
  const q = useMyPlaceSticker(placeId);
  const s = q.data;
  const milestone = !!s && s.found && (STICKER_THRESHOLDS as readonly number[]).includes(s.visits);
  // Confetti once per reveal: first sticker and every level-up.
  useEffect(() => {
    if (milestone) fireConfetti({ colors: stickerConfettiColors(stickerHue(placeId)), origin: { x: 0.5, y: 0.4 } });
  }, [milestone, placeId]);
  if (!s || !s.found) return null;
  const remaining = s.next_level_visits ? s.next_level_visits - s.visits : null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-card bg-soft-green/60 p-3 motion-safe:animate-rise-in" data-testid="sticker-reward">
      <div className={milestone ? "motion-safe:animate-sticker-in" : "motion-safe:animate-pop"}>
        <PlaceSticker placeId={placeId} name={placeName} category={s.category} level={s.level} size={64} />
      </div>
      <div className="min-w-0 text-left">
        <div className="text-sm font-semibold text-charcoal">
          {s.visits === 1 ? "New sticker collected!" : `Sticker level ${s.level} · ${STICKER_LEVEL_LABEL[s.level]}`}
        </div>
        <div className="text-xs text-charcoal-muted">
          {s.visits} {s.visits === 1 ? "visit" : "visits"}
          {remaining !== null
            ? ` · ${remaining} more to level ${s.level + 1}`
            : " · max level, you're a local legend"}
        </div>
      </div>
    </div>
  );
}

type Phase = "explain" | "checking" | "success" | "error";

const ERROR_COPY: Record<string, { title: string; body: string; action: string }> = {
  accuracy_too_low: {
    title: "Location isn't precise enough",
    body: "Move closer to the place or try again where your phone has a clearer signal.",
    action: "Try Again",
  },
  outside_radius: {
    title: "You're not close enough yet",
    body: "Verify your visit when you arrive at the place.",
    action: "Try Again",
  },
  already_checked_in: {
    title: "Visit already verified",
    body: "This visit has already been recorded.",
    action: "Done",
  },
  cooldown_active: {
    title: "Visit already verified",
    body: "This visit has already been recorded.",
    action: "Done",
  },
  location_permission_denied: {
    title: "Location access is off",
    body: "Allow location access in your browser settings to verify a visit.",
    action: "Got It",
  },
  location_unavailable: {
    title: "We couldn't find your location",
    body: "Check your connection and location settings, then try again.",
    action: "Try Again",
  },
  location_timeout: {
    title: "Location check timed out",
    body: "Try again where your phone has a clearer signal.",
    action: "Try Again",
  },
  location_unsupported: {
    title: "Location check isn't supported",
    body: "Open VeggieMeet in a browser that supports location services.",
    action: "Got It",
  },
  place_unavailable: {
    title: "This place isn't available",
    body: "You can't verify a visit here right now.",
    action: "Got It",
  },
  not_authenticated: {
    title: "Sign in to verify a visit",
    body: "You need to be signed in to record a visit.",
    action: "Got It",
  },
};

const RETRYABLE: CheckInReason[] = [
  "accuracy_too_low",
  "outside_radius",
  "location_unavailable",
  "location_timeout",
];

export function PlaceCheckInSheet({
  open,
  onOpenChange,
  placeId,
  placeName,
  alreadyCheckedIn,
  directionsHref,
  onCheckedIn,
  onViewImpact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeId: string;
  placeName: string;
  alreadyCheckedIn: boolean;
  directionsHref: string;
  onCheckedIn: () => void;
  onViewImpact?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("explain");
  const [reason, setReason] = useState<CheckInReason>("location_unavailable");
  const [newlySupported, setNewlySupported] = useState(true);
  const [supportedTotal, setSupportedTotal] = useState<number | null>(null);

  // Reset only when the dialog opens — later `alreadyCheckedIn` updates (e.g.
  // the refetch triggered by a successful check-in) must not clobber the
  // success state.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setPhase(alreadyCheckedIn ? "error" : "explain");
      if (alreadyCheckedIn) setReason("already_checked_in");
    }
    wasOpen.current = open;
  }, [open, alreadyCheckedIn]);

  async function run() {
    setPhase("checking");
    logAnalyticsEvent("community_place_check_in_started", { place_id: placeId });
    const result = await checkInToCommunityPlace(placeId);
    if (result.ok) {
      logAnalyticsEvent("community_place_check_in_succeeded", {
        place_id: placeId,
        verification_method: "device_location",
        is_first_visit_to_place: !!result.isFirstVisitToPlace,
      });
      if (typeof result.distinctPlacesSupported === "number") {
        logAnalyticsEvent("community_impact_place_count_updated", {
          new_distinct_count: result.distinctPlacesSupported,
        });
      }
      setNewlySupported(!!result.isFirstVisitToPlace);
      setSupportedTotal(
        typeof result.distinctPlacesSupported === "number"
          ? result.distinctPlacesSupported
          : null,
      );
      qc.invalidateQueries({ queryKey: ["place-checkin-state", placeId] });
      qc.invalidateQueries({ queryKey: ["place-detail", placeId] });
      qc.invalidateQueries({ queryKey: ["me-impact-overview"] });
      qc.invalidateQueries({ queryKey: ["impact-overview"] });
      qc.invalidateQueries({ queryKey: ["collection"] });
      onCheckedIn();
      setPhase("success");
      return;
    }
    logAnalyticsEvent("community_place_check_in_failed", {
      place_id: placeId,
      safe_reason_code: result.reason,
    });
    if (result.reason === "already_checked_in") {
      qc.invalidateQueries({ queryKey: ["place-checkin-state", placeId] });
      onCheckedIn();
    }
    setReason(result.reason);
    setPhase("error");
  }

  const copy = ERROR_COPY[reason] ?? ERROR_COPY.location_unavailable;

  return (
    <Dialog open={open} onOpenChange={(o) => phase !== "checking" && onOpenChange(o)}>
      <DialogContent className="rounded-dialog border-0 sm:max-w-sm max-h-[90dvh] overflow-y-auto">
        {phase === "explain" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-1 w-14 h-14 rounded-full bg-soft-green flex items-center justify-center text-primary">
                <MapPin className="w-7 h-7" aria-hidden />
              </div>
              <DialogTitle className="text-center text-xl">
                Verify your visit?
              </DialogTitle>
              {/* WO-095A DEF-095A-04: the sheet explained the location use but
                  never what Check In is *for* — supporting the place. */}
              <DialogDescription className="text-center">
                Verifying a visit records your support for this place and adds its sticker
                to your collection. VeggieMeet uses your location once to confirm you're
                here, and never saves it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <PrimaryButton fullWidth onClick={run}>
                Verify visit
              </PrimaryButton>
              <SecondaryButton fullWidth onClick={() => onOpenChange(false)}>
                Not Now
              </SecondaryButton>
            </DialogFooter>
          </>
        )}

        {phase === "checking" && (
          <div className="py-6 text-center" role="status" aria-live="polite">
            <div className="mx-auto mb-3 w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <p className="text-[15px] font-medium text-charcoal">
              Checking your location…
            </p>
          </div>
        )}

        {phase === "success" && (
          <div role="status" aria-live="polite">
            <DialogHeader>
              <div className="mx-auto mb-1 w-14 h-14 rounded-full bg-soft-green flex items-center justify-center text-primary">
                <CheckCircle2 className="w-7 h-7" aria-hidden />
              </div>
              <DialogTitle className="text-center text-xl">Visit verified</DialogTitle>
              <DialogDescription className="text-center">
                {newlySupported
                  ? `You supported ${placeName} and added it to your VeggieMeet impact.`
                  : `Your visit to ${placeName} was verified. This place was already part of your supported places.`}
              </DialogDescription>
            </DialogHeader>
            {supportedTotal !== null && (
              <p className="text-center text-sm text-charcoal-muted px-2">
                Community Places Supported: {supportedTotal}
              </p>
            )}
            <StickerReward placeId={placeId} placeName={placeName} />
            <div className="pt-2 flex justify-center">
              <TertiaryButton size="sm" onClick={() => navigate("/you/collection")}>
                <Sticker className="w-4 h-4" /> View my collection
              </TertiaryButton>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-col pt-2">
              <PrimaryButton fullWidth onClick={() => onOpenChange(false)}>
                Done
              </PrimaryButton>
              {onViewImpact && (
                <SecondaryButton fullWidth onClick={onViewImpact}>
                  View Supported Places
                </SecondaryButton>
              )}
            </DialogFooter>
          </div>
        )}

        {phase === "error" && (
          <div role="alert" aria-live="assertive">
            <DialogHeader>
              <DialogTitle className="text-center text-xl">{copy.title}</DialogTitle>
              <DialogDescription className="text-center break-words">
                {copy.body}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-col pt-2">
              {RETRYABLE.includes(reason) ? (
                <PrimaryButton fullWidth onClick={run}>
                  {copy.action}
                </PrimaryButton>
              ) : (
                <PrimaryButton fullWidth onClick={() => onOpenChange(false)}>
                  {copy.action}
                </PrimaryButton>
              )}
              {reason === "outside_radius" && (
                <SecondaryButton
                  fullWidth
                  onClick={() =>
                    window.open(directionsHref, "_blank", "noopener,noreferrer")
                  }
                >
                  <Navigation className="w-4 h-4 mr-1.5" />
                  Get Directions
                </SecondaryButton>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
