import { Link } from "react-router-dom";
import { Check, Clock, MapPin, Users } from "lucide-react";
import type { Meetup } from "@/types";
import { getPlace, getVeggie, veggies } from "@/lib/mock-data";
import { formatTime12h } from "@/lib/format";
import { useMeetupMembership } from "@/hooks/useMeetupMembership";
import { Card } from "./Card";
import { AvatarGroup } from "./UserAvatar";

interface Props {
  meetup: Meetup;
}

export function MeetupCard({ meetup }: Props) {
  const { role } = useMeetupMembership(meetup);
  const host = getVeggie(meetup.hostId);
  const place = getPlace(meetup.communityPlaceId);
  const placeLabel = meetup.location?.locationName ?? meetup.customLocation?.name ?? place?.name;
  const attendeeUsers = meetup.attendeeIds
    .map((id) => veggies.find((v) => v.id === id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const attendeeCount = meetup.attendeeIds.length;

  return (
    <Link to={`/meetup/${meetup.id}`} className="block">
      <Card interactive padding="none" className="overflow-hidden">
        <div className="flex gap-3 p-3">
          <img
            src={meetup.coverImageUrl}
            alt=""
            className="w-24 h-24 rounded-xl object-cover shrink-0 bg-muted"
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.includes("photo-1543353071")) {
                img.src =
                  "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80";
              }
            }}
          />

          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
              {meetup.category}
            </span>
            <h3 className="mt-0.5 font-semibold text-charcoal leading-snug line-clamp-2">
              {meetup.title}
            </h3>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-charcoal-muted">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatTime12h(meetup.startTime)}</span>
            </div>
            {placeLabel && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-charcoal-muted truncate">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{placeLabel}</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <AvatarGroup users={attendeeUsers} max={3} size="xs" totalCount={attendeeCount} />
              {role === "host" || role === "attendee" ? (
                <div className="flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <Check className="w-3 h-3" />
                  <span>{role === "host" ? "Hosting" : "You're going"}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[11px] text-charcoal-muted">
                  <Users className="w-3 h-3" />
                  <span>{attendeeCount} going</span>
                </div>
              )}
            </div>
            {host && (
              <div className="sr-only">Hosted by {host.displayName}</div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
