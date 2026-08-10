import { useNavigate } from "react-router-dom";
import { Clock, Users } from "lucide-react";
import { Card } from "@/components/app/Card";
import { ReasonPill } from "./ReasonPill";
import { RecCardMenu } from "./RecCardMenu";
import type { MeetupRecommendation } from "@/lib/today";

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
          <img
            src={meetup.cover_image_url ?? "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=800&q=80"}
            alt=""
            className="w-24 h-24 rounded-control object-cover bg-muted"
            loading="lazy"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <ReasonPill label={meetup.reason_label} />
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
              {meetup.is_attending ? "View meetup →" : "Join meetup →"}
            </span>
          </button>
        </div>
      </div>
    </Card>
  );
}
