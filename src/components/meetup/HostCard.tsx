import { useQuery } from "@tanstack/react-query";
import { Card, UserAvatar, ActiveHostBadge } from "@/components/app";
import { fetchPublicCommunityImpact } from "@/lib/communityImpact";
import { isUuid } from "@/lib/backend";
import type { Veggie } from "@/types";

interface Props {
  host: Veggie;
}

export function HostCard({ host }: Props) {
  // WO-063 — Hosting Meetups is a derived, server-authoritative metric. Never
  // render the client-writable profile counters for it.
  const impactQuery = useQuery({
    queryKey: ["public-impact", host.id],
    enabled: isUuid(host.id),
    queryFn: () => fetchPublicCommunityImpact(host.id),
    staleTime: 60_000,
  });

  const impact = impactQuery.data?.available ? impactQuery.data : null;
  const hosted = impact?.meetups_hosted ?? host.meetupsHostedCount;
  const connected = impact?.veggies_met ?? host.veggiesMetCount;

  return (
    <Card padding="md" className="bg-soft-green/60 border-transparent">
      <div className="flex items-center gap-3">
        <UserAvatar name={host.displayName} src={host.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-charcoal-muted">Hosted by</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-charcoal break-words min-w-0">{host.displayName}</span>
            {host.isActiveHost && <ActiveHostBadge />}
          </div>
        </div>
      </div>

      {host.bio && (
        <p className="mt-3 text-sm text-charcoal leading-relaxed">{host.bio}</p>
      )}

      <div className="mt-4 text-sm text-charcoal-muted leading-relaxed">
        Hosted <span className="font-semibold text-charcoal">{hosted}</span>{" "}
        {hosted === 1 ? "meetup" : "meetups"}
        <span className="mx-1.5 text-charcoal-muted/60">•</span>
        Helped <span className="font-semibold text-charcoal">{connected}</span> Veggies connect
      </div>
    </Card>
  );
}
