import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPin } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { logAnalyticsEvent } from "@/lib/analytics";
import { fieldLabel } from "@/lib/fieldLabels";
import {
  acceptMeetupCurrentPlaceLocation,
  type MeetupPlaceContext,
} from "@/lib/meetupPlaceContext";

interface Props {
  meetupId: string;
  context: MeetupPlaceContext;
  onUpdated: () => void;
}

/**
 * WO-062 — Host-facing location status for a Meetup hosted at a Community Place.
 * Shows the Meetup snapshot against the current Community Place and offers the
 * explicit, server-validated "update to current location" action.
 * Owner-only moderation detail is never shown here.
 */
export function MeetupLocationStatus({ meetupId, context, onUpdated }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const host = context.host;
  const place = context.place;
  if (!context.linked || !host || !place) return null;

  const attention = host.actionLevel !== "none" && !context.isHistorical;
  const state = place.locationIntegrityState;

  async function handleAccept() {
    setSaving(true);
    logAnalyticsEvent("meetup_location_update_started", { source: "accept_current_place" });
    try {
      await acceptMeetupCurrentPlaceLocation(meetupId);
      logAnalyticsEvent("meetup_location_update_completed", { result: "accepted_current_place" });
      toast({ title: "Meetup location updated" });
      setConfirmOpen(false);
      onUpdated();
    } catch (e) {
      logAnalyticsEvent("meetup_location_update_blocked", { reason: "server_rejected" });
      toast({
        title: "Couldn't update the location",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="meetup-location-status-heading" className="min-w-0">
      <h2
        id="meetup-location-status-heading"
        className="text-lg font-semibold text-charcoal"
      >
        Location status
      </h2>

      <div
        className={`mt-2 rounded-2xl border p-4 min-w-0 ${
          attention ? "border-warning/40 bg-warning/10" : "border-border bg-card"
        }`}
      >
        <p className="flex items-start gap-2 text-sm font-semibold text-charcoal">
          {attention ? (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-primary" aria-hidden />
          )}
          <span>{host.statusLabel}</span>
        </p>

        {host.changedFields.length > 0 && state === "details_changed" && (
          <p className="mt-1.5 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
            Changed since this Meetup was created:{" "}
            {host.changedFields.map((f) => fieldLabel(f)).join(", ")}
          </p>
        )}

        {context.isHistorical && (
          <p className="mt-1.5 text-xs text-charcoal-muted">
            This Meetup is historical — its location is kept as a record and no action
            is needed.
          </p>
        )}

        {attention && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-3 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
                Meetup location
              </p>
              <p className="mt-1 text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">
                {context.snapshot?.locationName ?? "—"}
              </p>
              <p className="mt-0.5 flex items-start gap-1.5 text-xs text-charcoal-muted">
                <MapPin className="w-3 h-3 shrink-0 mt-0.5" aria-hidden />
                <span className="[overflow-wrap:anywhere]">
                  {context.snapshot?.address ?? "—"}
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
                Current Community Place
              </p>
              <p className="mt-1 text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">
                {host.currentPlace?.name ?? "No longer available"}
              </p>
              <p className="mt-0.5 flex items-start gap-1.5 text-xs text-charcoal-muted">
                <MapPin className="w-3 h-3 shrink-0 mt-0.5" aria-hidden />
                <span className="[overflow-wrap:anywhere]">
                  {host.currentPlace?.address ?? "—"}
                </span>
              </p>
            </div>
          </div>
        )}

        {attention && (
          <div className="mt-3 flex flex-wrap gap-2">
            {host.canAcceptCurrentPlace ? (
              <button
                type="button"
                onClick={() => {
                  logAnalyticsEvent("meetup_location_review_opened", {
                    integrity_state: state,
                  });
                  setConfirmOpen(true);
                }}
                className="h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
              >
                Update Meetup to current location
              </button>
            ) : (
              <span className="text-xs text-charcoal-muted">
                Choose another location below — this place can't be used right now.
              </span>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[92vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Update the Meetup location?</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              The Meetup will move from “{context.snapshot?.address}” to “
              {host.currentPlace?.address}”. Attendees will be notified. The Community
              Place itself isn't changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleAccept();
              }}
              disabled={saving}
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />}
              Update location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
