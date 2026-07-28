import { Card, UserAvatar, ActiveHostBadge } from "@/components/app";
import type { Veggie } from "@/types";

interface Props {
  host: Veggie;
}

export function HostCard({ host }: Props) {
  return (
    <Card padding="md" className="bg-soft-green/60 border-transparent">
      <div className="flex items-center gap-3">
        <UserAvatar name={host.displayName} src={host.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-charcoal-muted">Hosted by</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-charcoal">{host.displayName}</span>
            {host.isActiveHost && <ActiveHostBadge />}
          </div>
        </div>
      </div>

      {host.bio && (
        <p className="mt-3 text-sm text-charcoal leading-relaxed">{host.bio}</p>
      )}

      <div className="mt-4 text-sm text-charcoal-muted leading-relaxed">
        Hosted <span className="font-semibold text-charcoal">{host.meetupsHostedCount}</span> {host.meetupsHostedCount === 1 ? "meetup" : "meetups"}
        <span className="mx-1.5 text-charcoal-muted/60">•</span>
        Helped <span className="font-semibold text-charcoal">{host.veggiesMetCount}</span> Veggies connect
      </div>
    </Card>
  );
}
