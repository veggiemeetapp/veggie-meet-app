import { useEffect } from "react";
import { CalendarClock, ChevronRight, RefreshCw } from "lucide-react";
import { logAnalyticsEvent } from "@/lib/analytics";
import { Link } from "react-router-dom";
import { useToday } from "@/hooks/useToday";
import { TodayHeader } from "@/components/today/TodayHeader";
import { TodaySkeleton } from "@/components/today/TodaySkeleton";
import { TodayError } from "@/components/today/TodayError";
import { TodayEmptyState } from "@/components/today/TodayEmptyState";
import { PrimaryActionCard } from "@/components/today/PrimaryActionCard";
import { MeetupRecCard } from "@/components/today/MeetupRecCard";
import { VeggieRecCard } from "@/components/today/VeggieRecCard";
import { PlaceRecCard } from "@/components/today/PlaceRecCard";
import { SectionHeader } from "@/components/app/SectionHeader";

/**
 * WO-078: Today never asks for device location. Ranking here is derived from
 * the member's Selected City (server-side), so there is no product reason to
 * prompt on render. The only location request in the product is the explicit
 * Community Place check-in action, which explains itself in context.
 */
export default function Today() {
  const { data, loading, error, refresh, refetching } = useToday();

  // WO-084A: surface view event (mount-only, deduped by the logger).
  useEffect(() => {
    logAnalyticsEvent("today_opened", {});
  }, []);

  if (loading) return <TodaySkeleton />;
  if (error || !data) return <TodayError onRetry={refresh} />;


  const {
    primary_action,
    meetup_recommendations,
    veggie_recommendations,
    place_recommendations,
  } = data;

  const nothing =
    !primary_action &&
    meetup_recommendations.length === 0 &&
    veggie_recommendations.length === 0 &&
    place_recommendations.length === 0;

  return (
    <div className="animate-fade-in pb-8">
      <TodayHeader />

      <div className="px-5 mt-2 flex items-center justify-between">
        <Link
          to="/plans"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-charcoal-muted hover:text-primary transition-colors"
        >
          <CalendarClock className="w-3.5 h-3.5" />
          My Plans
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
        <button
          onClick={refresh}
          disabled={refetching}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-charcoal-muted hover:text-primary transition-colors disabled:opacity-50"
          aria-label="Refresh Today"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>


      {primary_action && (
        <section className="px-5 mt-3" aria-label="Primary action">
          <PrimaryActionCard action={primary_action} />
        </section>
      )}

      {meetup_recommendations.length > 0 && (
        <section className="mt-6" aria-label="Meetup recommendations">
          <SectionHeader title="Upcoming Meetups" subtitle="Handpicked for you" />
          <div className="px-5 space-y-3">
            {meetup_recommendations.map((m) => (
              <MeetupRecCard key={m.entity_id} meetup={m} />
            ))}
          </div>
        </section>
      )}

      {veggie_recommendations.length > 0 && (
        <section className="mt-4" aria-label="Veggie recommendations">
          <SectionHeader title="People to Meet" subtitle="Fellow Veggies to connect with" />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 no-scrollbar">
            {veggie_recommendations.map((v) => (
              <VeggieRecCard key={v.entity_id} veggie={v} />
            ))}
          </div>
        </section>
      )}

      {place_recommendations.length > 0 && (
        <section className="mt-4" aria-label="Community places">
          <SectionHeader title="Community Places" subtitle="Veggie-friendly spots" />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 no-scrollbar">
            {place_recommendations.map((p) => (
              <PlaceRecCard key={p.entity_id} place={p} />
            ))}
          </div>
        </section>
      )}

      {nothing && (
        <div className="mt-6">
          <TodayEmptyState />
        </div>
      )}
    </div>
  );
}
