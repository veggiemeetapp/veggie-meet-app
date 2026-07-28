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
  const firstName = veggie.display_name.split(" ")[0];
  return (
    <Card padding="md" className="w-52 shrink-0">
      <div className="flex items-start justify-between">
        <button onClick={go} aria-label={`View ${firstName}`}>
          <UserAvatar name={veggie.display_name} src={veggie.avatar_url ?? undefined} size="md" />
        </button>
        <RecCardMenu
          entityType="profile"
          entityId={veggie.entity_id}
          reasonCode={veggie.reason_code}
          label={firstName}
        />
      </div>
      <button
        onClick={go}
        className="mt-2 block text-left w-full"
      >
        <h3 className="font-semibold text-charcoal text-sm">{firstName}</h3>
        {veggie.current_city && (
          <p className="text-[11px] text-charcoal-muted">{veggie.current_city}</p>
        )}
        <div className="mt-2">
          <ReasonPill label={veggie.reason_label} />
        </div>
        <span className="mt-3 inline-block text-xs font-semibold text-primary">
          View profile →
        </span>
      </button>
    </Card>
  );
}
