import { useNavigate } from "react-router-dom";
import { Calendar, Check, Clock, Loader2, MapPin, Ticket, Users } from "lucide-react";
import { PrimaryButton, ProgressiveImage, SecondaryButton } from "@/components/app";
import type { HydratedInvitation } from "@/lib/invitations";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { useMeetupCategoryLabel } from "@/lib/meetupCategory";
import { cn } from "@/lib/utils";
import { FALLBACK_COVER } from "@/lib/backend";

interface Props {
  bundle: HydratedInvitation;
  isRecipient: boolean;
  isSender: boolean;
  onJoin: () => void;
  joining?: boolean;
  className?: string;
}

/**
 * A structured, non-promotional Meetup invitation card rendered inside a
 * one-to-one conversation. State is derived live from Meetup + attendance
 * data so it always reflects reality (full, cancelled, ended).
 */
export function InvitationCard({
  bundle,
  isRecipient,
  isSender,
  onJoin,
  joining,
  className,
}: Props) {
  const navigate = useNavigate();
  const { meetup, invitation, recipientAttending } = bundle;
  // WO-126A — canonical Primary label wins over the legacy compatibility enum.
  const categoryLabel = useMeetupCategoryLabel(meetup.primaryInterestId, meetup.category);

  // Derive the visible state from live meetup data, not stored status.
  let visibleStatus: "invited" | "viewed" | "joined" | "full" | "cancelled" | "ended";
  if (recipientAttending || invitation.status === "joined") visibleStatus = "joined";
  else if (meetup.status === "cancelled") visibleStatus = "cancelled";
  else if (meetup.status === "ended") visibleStatus = "ended";
  else if (meetup.status === "full") visibleStatus = "full";
  else if (invitation.status === "viewed") visibleStatus = "viewed";
  else visibleStatus = "invited";

  const canJoin = isRecipient && visibleStatus === "invited"
    || (isRecipient && visibleStatus === "viewed");

  return (
    <div
      className={cn(
        "w-full max-w-[86%] rounded-card border border-border/70 bg-card overflow-hidden shadow-soft",
        className,
      )}
      role="group"
      aria-label="Meetup invitation"
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <Ticket className="w-3 h-3" />
        Meetup Invitation
      </div>
      {invitation.personal_message && (
        <div className="px-3 pt-1.5 text-sm text-charcoal">
          {invitation.personal_message}
        </div>
      )}
      <div className="px-3 pt-3">
        <ProgressiveImage
          src={meetup.coverImageUrl}
          fallbackSrc={FALLBACK_COVER}
          alt=""
          containerClassName="w-full h-32 rounded-control"
          loading="lazy"
        />
      </div>
      <div className="px-3 pt-2.5 pb-3">
        {categoryLabel && (
          <div className="text-[10px] font-semibold uppercase tracking-wider text-charcoal-muted">
            {categoryLabel}
          </div>
        )}
        <div className="mt-0.5 font-semibold text-charcoal leading-snug line-clamp-2">
          {meetup.title}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-charcoal-muted">
          <span className="inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatMeetupDate(meetup.date)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTime12h(meetup.startTime)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="w-3 h-3" />
            {meetup.attendeeCount}/{meetup.capacity}
          </span>
        </div>
        {meetup.locationLabel && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-charcoal-muted truncate max-w-full">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{meetup.locationLabel}</span>
          </div>
        )}
        <div className="mt-1 text-[11px] text-charcoal-muted">
          Hosted by {meetup.hostName}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <StatusPill status={visibleStatus} />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {canJoin ? (
            <PrimaryButton
              size="sm"
              onClick={onJoin}
              disabled={joining}
              className="w-full"
            >
              {joining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Join Meetup
            </PrimaryButton>
          ) : visibleStatus === "joined" ? (
            <SecondaryButton size="sm" disabled className="w-full">
              <Check className="w-4 h-4" />
              {isRecipient ? "You're going" : "They joined"}
            </SecondaryButton>
          ) : null}
          <SecondaryButton
            size="sm"
            onClick={() => navigate(`/meetup/${meetup.id}`)}
            className="w-full"
          >
            View Meetup
          </SecondaryButton>
        </div>
        {isSender && !isRecipient && visibleStatus === "invited" && (
          <div className="mt-2 text-[11px] text-charcoal-muted text-center">
            Waiting for a reply.
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<
  "invited" | "viewed" | "joined" | "full" | "cancelled" | "ended",
  string
> = {
  invited: "Invited",
  viewed: "Viewed",
  joined: "Joined",
  full: "Meetup full",
  cancelled: "Meetup cancelled",
  ended: "Meetup has ended",
};

function StatusPill({
  status,
}: {
  status: keyof typeof STATUS_LABEL;
}) {
  const positive = status === "joined";
  const warn =
    status === "cancelled" || status === "ended" || status === "full";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold",
        positive
          ? "bg-soft-green text-primary"
          : warn
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-charcoal-muted",
      )}
      aria-label={`Invitation status: ${STATUS_LABEL[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
