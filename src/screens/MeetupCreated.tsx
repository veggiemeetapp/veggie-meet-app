import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Sparkles, Calendar, Clock, MapPin, MessageCircle, UserPlus } from "lucide-react";
import { Card, PrimaryButton, SecondaryButton } from "@/components/app";

import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { fetchMeetupById, isUuid } from "@/lib/backend";
import type { Meetup } from "@/types";
import { useMeetupCategoryLabel } from "@/lib/meetupCategory";
import { InviteVeggiesSheet } from "@/components/invitations/InviteVeggiesSheet";

export default function MeetupCreated() {
  const { id } = useParams();
  const [meetup, setMeetup] = useState<Meetup | null | undefined>(undefined);
  // WO-144 — invite connected Veggies straight after publishing.
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (!id || meetup) return;
    if (!isUuid(id)) {
      setMeetup(null);
      return;
    }
    fetchMeetupById(id).then((m) => setMeetup(m));
  }, [id, meetup]);

  // WO-126A — canonical Primary label; legacy enum only for historical Meetups.
  const categoryLabel = useMeetupCategoryLabel(meetup?.primaryInterestId, meetup?.category);
  const placeLabel = meetup?.location?.locationName ?? meetup?.customLocation?.name;
  const placeAddr = meetup?.location?.address ?? meetup?.customLocation?.address;

  return (
    <div className="flex flex-col min-h-dvh page-x pt-16 pb-10">
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-soft-green flex items-center justify-center">
          <Sparkles className="w-9 h-9 text-primary" strokeWidth={2} />
        </div>
        <h1 className="mt-6 text-[26px] font-semibold text-charcoal tracking-tight">
          Your Meetup is Live
        </h1>
        <p className="mt-2 text-charcoal-muted max-w-xs leading-relaxed">
          People can now discover and join your meetup.
        </p>
      </div>

      {meetup && (
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
              <span>{formatTime12h(meetup.startTime)}</span>
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
      )}

      <div className="mt-auto pt-14 flex flex-col gap-3">
        {meetup && (
          <Link to={`/meetup/${meetup.id}`} className="block">
            <PrimaryButton fullWidth className="shadow-lg ring-1 ring-primary/20">
              View Meetup
            </PrimaryButton>
          </Link>
        )}
        {meetup?.chatId && (
          <Link to={`/chat/${meetup.chatId}`} className="block">
            <SecondaryButton fullWidth>
              <MessageCircle className="w-4 h-4" />
              Open meetup chat
            </SecondaryButton>
          </Link>
        )}
        {meetup && (
          <SecondaryButton fullWidth onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4" />
            Invite Veggies
          </SecondaryButton>
        )}
        <Link to="/" className="block">
          <SecondaryButton fullWidth>Back to Today</SecondaryButton>
        </Link>
      </div>

      {meetup && (
        <InviteVeggiesSheet
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          meetupId={meetup.id}
          meetupTitle={meetup.title}
        />
      )}
    </div>
  );
}
