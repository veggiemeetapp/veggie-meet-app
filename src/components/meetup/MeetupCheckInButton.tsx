import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/app";
import {
  checkInBlockedCopy,
  checkInToMeetup,
  fetchMyAttendance,
} from "@/lib/meetupAttendance";

/**
 * WO-066 — attendee self check-in.
 * Presentation only: every rule (membership, timing window, completion)
 * is decided server-side and surfaced here as calm member copy.
 */
export function MeetupCheckInButton({
  meetupId,
  profileId,
  startsAt,
  endsAt,
}: {
  meetupId: string;
  profileId: string;
  /** Local ISO-ish `YYYY-MM-DDTHH:mm` for presentation gating only. */
  startsAt?: string;
  endsAt?: string;
}) {
  const qc = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["my-attendance", meetupId, profileId],
    queryFn: () => fetchMyAttendance(meetupId, profileId),
    staleTime: 0,
  });


  const mutation = useMutation({
    mutationFn: () => checkInToMeetup(meetupId),
    onSuccess: (res) => {
      if (res.result === "blocked") {
        toast.error(checkInBlockedCopy(res.reason));
      } else if (res.result === "already_checked_in") {
        toast.success("You're already checked in.");
      } else {
        toast.success("You're checked in to this Meetup.");
      }
      qc.invalidateQueries({ queryKey: ["my-attendance", meetupId] });
      qc.invalidateQueries({ queryKey: ["meetup-lifecycle", meetupId] });
      qc.invalidateQueries({ queryKey: ["managed-attendees", meetupId] });
    },
    onError: (e: Error) => toast.error(e.message || "Check-in didn't go through."),
  });

  if (isPending) return null;

  if (data?.status === "checked_in" || data?.status === "attended") {
    return (
      <div
        className="flex items-center justify-center gap-2 text-sm font-semibold text-primary"
        aria-live="polite"
      >
        <CheckCircle2 className="w-4 h-4" />
        You're checked in
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
        Check-in opens an hour before the Meetup starts.
      </p>
    );
  }
  if (!Number.isNaN(endMs) && now > endMs + 4 * 60 * 60 * 1000) return null;

  return (
    <PrimaryButton
      fullWidth
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <MapPin className="w-4 h-4" />
      {mutation.isPending ? "Checking in…" : "I'm here — check in"}
    </PrimaryButton>
  );

}
