import { Link } from "react-router-dom";
import { Check, Clock, MapPin, Users } from "lucide-react";
import type { Meetup } from "@/types";

import { formatTime12h } from "@/lib/format";
import { useMeetupMembership } from "@/hooks/useMeetupMembership";
import type { MeetupRole } from "@/lib/backend";
import { Card } from "./Card";
import { AvatarGroup } from "./UserAvatar";

interface Props {
  meetup: Meetup;
  /**
   * WO-087: when the surface already knows the viewer's role from a
   * server-authoritative read (e.g. `/you`), pass it in to skip the per-card
   * membership query and realtime channel.
   */
  role?: MeetupRole;
}

export function MeetupCard({ meetup, role: roleOverride }: Props) {
  const membership = useMeetupMembership(roleOverride ? null : meetup);
  const role = roleOverride ?? membership.role;
  // WO-095: host / place / attendee identities are server-authoritative. This
  // card used to fall back to the mock-data fixture, which could render
  // fixture people as if they were real members.
  const placeLabel = meetup.location?.locationName ?? meetup.customLocation?.name;
  const attendeeUsers: { displayName: string; avatarUrl?: string }[] = [];
  const attendeeCount = meetup.attendeeIds.length;

  return (
    <Link to={`/meetup/${meetup.id}`} className="block">
      <Card interactive padding="none" className="overflow-hidden">
        <div className="flex gap-3 p-3">
          <img
            src={meetup.coverImageUrl}
            alt=""
            className="w-24 h-24 rounded-control object-cover shrink-0 bg-muted"
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
          </div>
        </div>
      </Card>
    </Link>
  );
}
