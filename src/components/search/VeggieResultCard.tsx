import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { Card, UserAvatar } from "@/components/app";
import { ResultReasonPill } from "./ResultReasonPill";
import type { VeggieResult } from "@/lib/search";

interface Props {
  result: VeggieResult;
}

const relLabel: Record<VeggieResult["relationship"], string | null> = {
  none: null,
  pending: "Requested",
  connected: "Connected",
  verified: "Verified",
};

export function VeggieResultCard({ result }: Props) {
  return (
    <Link
      to={`/veggie/${result.entity_id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl"
    >
      <Card interactive padding="md" className="flex gap-3 items-start">
        <UserAvatar name={result.display_name} src={result.avatar_url ?? undefined} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold text-sm text-charcoal truncate">{result.display_name}</h3>
            {relLabel[result.relationship] && (
              <span className="text-[10px] font-medium text-charcoal-muted shrink-0">
                {relLabel[result.relationship]}
              </span>
            )}
          </div>
          {result.city_name && (
            <div className="flex items-center gap-1 text-[11px] text-charcoal-muted mt-0.5">
              <MapPin className="w-3 h-3" aria-hidden />
              <span className="truncate">{result.city_name}</span>
            </div>
          )}
          {result.bio && (
            <p className="text-xs text-charcoal-muted mt-1 line-clamp-2">{result.bio}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ResultReasonPill label={result.reason_label} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
