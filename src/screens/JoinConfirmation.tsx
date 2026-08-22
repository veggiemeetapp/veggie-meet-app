import { memberSafeMessage } from "@/lib/errors";
import { logAnalyticsEvent } from "@/lib/analytics";
import { safeBack } from "@/lib/navigation";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Calendar, Clock, MapPin } from "lucide-react";
import { Card, PrimaryButton, SecondaryButton, BackButton } from "@/components/app";
import { AddToGoogleCalendarButton } from "@/components/meetup";


import { formatMeetupDate, formatTimeRange } from "@/lib/format";
import { fetchMeetupById, isUuid, joinMeetup } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import type { Meetup } from "@/types";
import { useMeetupCategoryLabel } from "@/lib/meetupCategory";

export default function JoinConfirmation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [meetup, setMeetup] = useState<Meetup | null | undefined>(undefined);
  const [joining, setJoining] = useState<boolean>(!!id && isUuid(id));
  const [joinError, setJoinError] = useState<string | null>(null);
  // WO-126A — canonical Primary label; legacy enum only for historical Meetups.
  const categoryLabel = useMeetupCategoryLabel(meetup?.primaryInterestId, meetup?.category);

  // Load backend meetup if not in mock data
  useEffect(() => {
    if (!id || meetup) return;
    if (!isUuid(id)) {
      setMeetup(null);
      return;
    }
    fetchMeetupById(id).then((m) => setMeetup(m));
  }, [id, meetup]);

  // Persist attendance via canonical RPC. Capacity / status / time errors
  // surface as a user-facing message (no optimistic "You're going").
  useEffect(() => {
    if (!id || !profile?.id || !isUuid(id)) {
      setJoining(false);
      return;
    }
    let cancelled = false;
    setJoining(true);
    setJoinError(null);
    joinMeetup(profile.id, id)
      .then((res) => {
        // WO-096 DEF-096-01: joining a Meetup is a level-2 activation outcome.
        if (!cancelled) logAnalyticsEvent("meetup_joined", { meetup_id: id });
        if (!cancelled && res.chatId) {
          setMeetup((prev) =>
            prev && !prev.chatId ? { ...prev, chatId: res.chatId! } : prev,
          );
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setJoinError(memberSafeMessage(err));
      })
      .finally(() => {
        if (!cancelled) setJoining(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, profile?.id]);




  if (meetup === undefined) {
    return (
      <div className="flex flex-col min-h-dvh items-center justify-center text-sm text-charcoal-muted">
        Loading…
      </div>
    );
  }

  if (!meetup) {
    return (
      <div className="flex flex-col min-h-dvh">
        <div className="safe-top flex items-center page-x pt-3 pb-2">
          <BackButton fallback="/plans" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">We couldn't find this meetup.</p>
          <button
            onClick={() => navigate("/")}
            className="mt-2 text-sm font-semibold text-primary"
          >
            Back to Today
          </button>
        </div>
      </div>
    );
  }

  const placeLabel = meetup.location?.locationName ?? meetup.customLocation?.name;
  const placeAddr = meetup.location?.address ?? meetup.customLocation?.address;
  const isHost = profile?.id && profile.id === meetup.hostId;

  return (
    <div className="flex flex-col min-h-dvh page-x pt-4 pb-10">
      <div className="safe-top -mx-5 page-x pb-2">
        <BackButton fallback="/plans" />
      </div>
      {joinError ? (
        <div className="flex flex-col items-center text-center pt-8">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
            <ArrowLeft className="w-10 h-10 text-charcoal-muted" />
          </div>
          <h1 className="mt-6 text-[26px] font-semibold text-charcoal tracking-tight">
            We couldn't save your spot
          </h1>
          <p className="mt-2 text-charcoal-muted max-w-xs leading-relaxed">{joinError}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center pt-8">
          <div className="w-20 h-20 rounded-full bg-soft-green flex items-center justify-center">
            <Check className="w-10 h-10 text-primary" strokeWidth={2.5} />
          </div>
          <h1 className="mt-6 text-[26px] font-semibold text-charcoal tracking-tight">
            {isHost ? "You're hosting" : joining ? "Saving your spot…" : "You're in"}
          </h1>
          <p className="mt-2 text-charcoal-muted max-w-xs leading-relaxed">
            {isHost
              ? "You're already set for this meetup — jump into the chat to welcome everyone."
              : "We've saved your spot. Get to know everyone before the meetup."}
          </p>
        </div>
      )}


      <Card padding="md" className="mt-8">
        {categoryLabel && (
          <div className="text-xs font-semibold text-primary uppercase tracking-wider">
            {categoryLabel}
          </div>
        )}
        <div className="mt-1 text-lg font-semibold text-charcoal leading-tight">
          {meetup.title}
        </div>
        <div className="mt-4 space-y-2.5 text-sm text-charcoal">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <span>{formatMeetupDate(meetup.date)}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-primary shrink-0" />
            <span>{formatTimeRange(meetup.startTime, meetup.endTime)}</span>
          </div>
          {placeLabel && (
            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">{placeLabel}</span>
                {placeAddr && (
                  <span className="block text-charcoal-muted text-xs mt-0.5">
                    {placeAddr}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* WO-117: optional, non-blocking calendar export. Joining already
          succeeded — skipping or failing this never changes RSVP state. */}
      {!joinError && !joining && (
        <div className="mt-4">
          <AddToGoogleCalendarButton
            meetup={meetup}
            surface="post_join"
            variant="outline"
          />
        </div>
      )}

      <div className="mt-auto pt-12 flex flex-col gap-3">
        {meetup.chatId ? (
          <PrimaryButton
            fullWidth
            className="bg-primary shadow-md hover:bg-primary"
            disabled={joining}
            onClick={() => navigate(`/chat/${meetup.chatId}`)}
          >
            {joining ? "Saving your spot…" : "Open meetup chat"}
          </PrimaryButton>
        ) : (
          <Link to={`/group/${meetup.id}`}>
            <PrimaryButton fullWidth className="bg-primary shadow-md hover:bg-primary">
              Meet the group
            </PrimaryButton>
          </Link>
        )}


        <Link to="/">
          <SecondaryButton fullWidth>Back to Today</SecondaryButton>
        </Link>
      </div>
    </div>
  );
}
