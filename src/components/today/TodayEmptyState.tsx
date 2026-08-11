import { useNavigate } from "react-router-dom";
import { Sprout } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";

/**
 * WO-095 §32: this state used to offer three competing buttons. A first-session
 * member gets exactly one next step — exploring verified Community Places is
 * the action that works even with zero social activity.
 */
export function TodayEmptyState() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Sprout aria-hidden />}
      title="Your VeggieMeet starts here"
      description="VeggieMeet is growing in your area. Start with a verified vegan place near you."
      action={
        <button
          type="button"
          onClick={() => navigate("/community/places")}
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Explore Community Places
        </button>
      }
    />
  );
}
