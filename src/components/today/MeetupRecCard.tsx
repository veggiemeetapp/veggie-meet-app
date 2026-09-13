import { useNavigate } from "react-router-dom";
import { Clock, Users } from "lucide-react";
import { Card } from "@/components/app/Card";
import { ReasonPill } from "./ReasonPill";
import { RecCardMenu } from "./RecCardMenu";
import type { MeetupRecommendation } from "@/lib/today";
import { ProgressiveImage } from "@/components/app/ProgressiveImage";
import { FALLBACK_COVER, sanitizeCover } from "@/lib/backend";

interface Props {
  meetup: MeetupRecommendation;
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${m.toString().padStart(2, "0")} ${suffix}`;
}

export function MeetupRecCard({ meetup }: Props) {
  const navigate = useNavigate();
  const go = () => navigate(`/meetup/${meetup.entity_id}`);
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex gap-3 p-3">
        <button
          onClick={go}
          className="shrink-0"
          aria-label={`View ${meetup.title}`}
        >
          <ProgressiveImage
            src={sanitizeCover(meetup.cover_image_url)}
            fallbackSrc={FALLBACK_COVER}
            alt=""
            containerClassName="w-24 h-24 rounded-control"
            loading="lazy"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {/* WO-127: a hosted Meetup keeps its place in Upcoming Meetups and
                carries a restrained hosting indicator instead of a second
                competing pill. It never replaces the canonical category label. */}
            {meetup.is_host ? (
              <span className="inline-flex max-w-full items-center truncate rounded-full border border-primary/30 bg-background px-2 py-0.5 text-[10px] font-semibold text-primary">
                You’re hosting
              </span>
            ) : (
              <ReasonPill label={meetup.reason_label} />
            )}
            <RecCardMenu
              entityType="meetup"
              entityId={meetup.entity_id}
              reasonCode={meetup.reason_code}
              label={meetup.title}
            />
          </div>

          <button
            onClick={go}
            className="mt-1 block text-left w-full"
          >
            <h3 className="font-semibold text-charcoal leading-snug line-clamp-2">
              {meetup.title}
            </h3>
            <div className="mt-1 flex items-center gap-3 text-xs text-charcoal-muted">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {formatTime(meetup.start_time)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> {meetup.attendee_count}/{meetup.capacity}
              </span>
            </div>
            <span className="mt-2 inline-block text-xs font-semibold text-primary">
              {meetup.is_attending || meetup.is_host ? "View meetup →" : "Join meetup →"}
            </span>

          </button>
        </div>
      </div>
    </Card>
  );
}
