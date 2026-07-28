import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";
import { Card } from "@/components/app/Card";
import type { PrimaryAction } from "@/lib/today";

interface Props {
  action: PrimaryAction;
}

function routeFor(a: PrimaryAction): string {
  switch (a.action_type) {
    case "open_check_in":
      return `/checkin/${a.entity_id}`;
    case "view_meetup":
    case "view_summary":
      return a.action_type === "view_summary"
        ? `/meetup/${a.entity_id}/summary`
        : `/meetup/${a.entity_id}`;
    case "respond_invitation":
      return `/chats`; // invitations are surfaced in chats/inbox
    case "respond_connection":
      return `/network`;
    default:
      return `/community`;
  }
}

export function PrimaryActionCard({ action }: Props) {
  const navigate = useNavigate();
  const primaryRoute = routeFor(action);
  const secondaryRoute =
    action.action_type === "open_check_in" ? `/meetup/${action.entity_id}` : undefined;

  return (
    <Card
      padding="lg"
      className="bg-gradient-to-br from-primary/10 via-soft-green to-background border-primary/20"
      role="region"
      aria-label={action.title}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {action.reason_label}
        </span>
        {action.time_context && (
          <span className="inline-flex items-center gap-1 text-[11px] text-charcoal-muted">
            <Clock className="w-3 h-3" /> {action.time_context}
          </span>
        )}
      </div>
      <h2 className="mt-2 text-lg font-semibold text-charcoal leading-snug">
        {action.title}
      </h2>
      {action.supporting_text && (
        <p className="mt-1 text-sm text-charcoal-muted line-clamp-2">
          {action.supporting_text}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => navigate(primaryRoute)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft hover:bg-primary/90 active:scale-[0.98] transition"
        >
          {action.action_label}
          <ArrowRight className="w-4 h-4" />
        </button>
        {action.secondary_action_label && secondaryRoute && (
          <button
            onClick={() => navigate(secondaryRoute)}
            className="inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            {action.secondary_action_label}
          </button>
        )}
      </div>
    </Card>
  );
}
