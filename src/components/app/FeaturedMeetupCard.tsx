import { Link } from "react-router-dom";
import { Calendar, Check, MapPin, MessageCircle, Users } from "lucide-react";
import type { Meetup } from "@/types";
import { getPlace, getVeggie, veggies } from "@/lib/mock-data";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { useMeetupMembership } from "@/hooks/useMeetupMembership";
import { AvatarGroup } from "./UserAvatar";
import { ActiveHostBadge } from "./Badges";
import { PrimaryButton, SecondaryButton } from "./Buttons";

interface Props {
  meetup: Meetup;
}

export function FeaturedMeetupCard({ meetup }: Props) {
  const { role, loading: membershipLoading } = useMeetupMembership(meetup);
  const host = getVeggie(meetup.hostId);
  const place = getPlace(meetup.communityPlaceId);
  const placeLabel = meetup.location?.locationName ?? meetup.customLocation?.name ?? place?.name;
  const attendeeUsers = meetup.attendeeIds
    .map((id) => veggies.find((v) => v.id === id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const attendeeCount = meetup.attendeeIds.length;

  return (
    <article className="rounded-3xl overflow-hidden shadow-card border border-border/60 bg-card">
      <Link to={`/meetup/${meetup.id}`} className="block group">
        <div className="relative h-56 overflow-hidden">
          <img
            src={meetup.coverImageUrl}
            alt=""
            className="w-full h-full object-cover group-active:scale-[1.02] transition-transform duration-500 bg-muted"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.includes("photo-1543353071")) {
                img.src =
                  "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80";
              }
            }}
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-background/90 backdrop-blur text-primary">
              ✨ Featured
            </span>
          </div>
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-90 mb-1">
              {meetup.category}
            </div>
            <h3 className="text-2xl font-semibold leading-tight drop-shadow-sm">
              {meetup.title}
            </h3>
          </div>
        </div>
      </Link>

      <div className="p-5">
        <div className="flex items-center gap-1.5 text-sm text-charcoal-muted">
          <Calendar className="w-4 h-4" />
          <span>
            {formatMeetupDate(meetup.date)}, {formatTime12h(meetup.startTime)}
          </span>
        </div>
        {placeLabel && (
          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-charcoal-muted">
            <MapPin className="w-4 h-4" />
            <span className="truncate">{placeLabel}</span>
          </div>
        )}

        {host && (
          <div className="mt-4 flex items-center gap-2">
            <img
              src={host.avatarUrl}
              alt=""
              className="w-8 h-8 rounded-full bg-accent"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-charcoal truncate">
                Hosted by {host.displayName}
              </div>
            </div>
            {host.isActiveHost && <ActiveHostBadge className="ml-1" />}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AvatarGroup users={attendeeUsers} max={4} size="sm" totalCount={attendeeCount} />
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-charcoal-muted">
            <Users className="w-3.5 h-3.5" />
            <span>{attendeeCount} Veggies going</span>
          </div>
        </div>

        <div className="mt-5">
          {membershipLoading ? (
            <PrimaryButton fullWidth disabled>Loading…</PrimaryButton>
          ) : role === "host" || role === "attendee" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-primary">
                <Check className="w-4 h-4" />
                {role === "host" ? "You're hosting" : "You're going"}
              </div>
              <Link to={`/meetup/${meetup.id}`} className="block">
                <SecondaryButton fullWidth>
                  <MessageCircle className="w-4 h-4" />
                  Open meetup chat
                </SecondaryButton>
              </Link>
            </div>
          ) : (
            <Link to={`/meetup/${meetup.id}`} className="block">
              <PrimaryButton fullWidth>Join Meetup</PrimaryButton>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
