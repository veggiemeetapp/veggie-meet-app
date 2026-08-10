import { useNavigate } from "react-router-dom";
import { Card } from "@/components/app/Card";
import { UserAvatar } from "@/components/app/UserAvatar";
import { ReasonPill } from "./ReasonPill";
import { RecCardMenu } from "./RecCardMenu";
import type { VeggieRecommendation } from "@/lib/today";

interface Props {
  veggie: VeggieRecommendation;
}

export function VeggieRecCard({ veggie }: Props) {
  const navigate = useNavigate();
  const go = () => navigate(`/veggie/${veggie.entity_id}`);
  // WO-088 DEF-088-04: the card used to render only the first whitespace token
  // of the display name, so "QA Actor A" collapsed to an ambiguous "QA".
  // The full name is now rendered (clamped to two lines, never overflowing) and
  // the accessible name always exposes the complete member name.
  const fullName = veggie.display_name.trim();
  return (
    <Card padding="md" className="w-52 max-w-full shrink-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <button onClick={go} aria-label={`View ${fullName}'s profile`} className="shrink-0">
          <UserAvatar name={fullName} src={veggie.avatar_url ?? undefined} size="md" />
        </button>
        <RecCardMenu
          entityType="profile"
          entityId={veggie.entity_id}
          reasonCode={veggie.reason_code}
          label={fullName}
        />
      </div>
      <button
        onClick={go}
        aria-label={`View ${fullName}'s profile`}
        className="mt-2 block text-left w-full min-w-0"
      >
        <h3 className="font-semibold text-charcoal text-sm line-clamp-2 break-words">
          {fullName}
        </h3>
        {veggie.current_city && (
          <p className="text-[11px] text-charcoal-muted truncate">{veggie.current_city}</p>
        )}
        <div className="mt-2 min-w-0">
          <ReasonPill label={veggie.reason_label} />
        </div>
        <span className="mt-3 inline-block text-xs font-semibold text-primary">
          View profile →
        </span>
      </button>
    </Card>
  );
}
