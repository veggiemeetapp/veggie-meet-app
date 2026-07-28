import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Compass } from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
} from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMyPlans,
  groupPastByMonth,
  groupUpcoming,
  type MyPlansResponse,
  type PlanItem,
} from "@/lib/plans";
import { PlanCard } from "@/components/plans/PlanCard";

export default function Plans() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ["my-plans", profile?.id],
    enabled: !!profile?.id,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchMyPlans(pageParam, 20),
    getNextPageParam: (last: MyPlansResponse) => last.past_next_cursor,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["my-plans", profile?.id] });

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`plans:${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetup_invitations", filter: `recipient_id=eq.${profile.id}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance", filter: `profile_id=eq.${profile.id}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetups" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetup_follow_up_state", filter: `profile_id=eq.${profile.id}` }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const firstPage = query.data?.pages[0];
  const allPast: PlanItem[] = (query.data?.pages ?? []).flatMap((p) => p.past);

  const needs = firstPage?.needs_attention ?? [];
  const upcoming = firstPage?.upcoming ?? [];
  const hosting = firstPage?.hosting ?? [];

  const isLoading = query.isLoading;
  const isError = query.isError;
  const hasAny = needs.length + upcoming.length + hosting.length + allPast.length > 0;

  const grouped = groupUpcoming(upcoming);
  const pastGroups = groupPastByMonth(allPast);

  return (
    <>
      <AppHeader
        title="My Plans"
        left={
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="min-w-11 min-h-11 w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-charcoal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        }
      />

      <div className="px-5 pt-3 pb-10 space-y-8">
        {isLoading ? (
          <div className="space-y-3" aria-live="polite" aria-busy="true">
            <Card className="h-28 animate-pulse" />
            <Card className="h-28 animate-pulse" />
          </div>
        ) : isError ? (
          <EmptyState
            title="We couldn't load your plans."
            description="Check your connection and try again."
            action={<PrimaryButton onClick={() => query.refetch()}>Try again</PrimaryButton>}
          />
        ) : !hasAny ? (
          <EmptyState
            title="You don't have any upcoming plans."
            description="Explore Meetups and find something that feels right."
            icon={<CalendarClock className="w-6 h-6" aria-hidden />}
            action={
              <div className="flex flex-col gap-2 w-full">
                <PrimaryButton fullWidth onClick={() => navigate("/community")}>
                  <Compass className="w-4 h-4" /> Explore Community
                </PrimaryButton>
                <SecondaryButton fullWidth onClick={() => navigate("/search")}>
                  Search Meetups
                </SecondaryButton>
                <SecondaryButton fullWidth onClick={() => navigate("/host")}>
                  Host a Meetup
                </SecondaryButton>
              </div>
            }
          />
        ) : (
          <>
            {needs.length > 0 && (
              <PlansSection title="Needs Attention" plans={needs} variant="attention" onChanged={invalidate} />
            )}

            {upcoming.length > 0 && (
              <section>
                <SectionTitle>Upcoming</SectionTitle>
                {(["today", "tomorrow", "this_week", "later"] as const).map((key) =>
                  grouped[key].length === 0 ? null : (
                    <div key={key} className="mt-4">
                      <SubHeading>{groupLabel(key)}</SubHeading>
                      <div className="space-y-3 mt-2">
                        {grouped[key].map((p) => (
                          <PlanCard key={p.meetup_id} plan={p} onChanged={invalidate} />
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </section>
            )}

            {hosting.length > 0 && (
              <PlansSection title="Hosting" plans={hosting} onChanged={invalidate} />
            )}

            {allPast.length > 0 && (
              <section>
                <SectionTitle>Past</SectionTitle>
                <div className="space-y-6 mt-2">
                  {pastGroups.map((g) => (
                    <div key={g.label}>
                      <SubHeading>{g.label}</SubHeading>
                      <div className="space-y-3 mt-2">
                        {g.items.map((p) => (
                          <PlanCard key={p.meetup_id} plan={p} onChanged={invalidate} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {query.hasNextPage && (
                  <div className="mt-4 flex justify-center">
                    <SecondaryButton
                      size="sm"
                      onClick={() => query.fetchNextPage()}
                      disabled={query.isFetchingNextPage}
                    >
                      {query.isFetchingNextPage ? "Loading…" : "Load more"}
                    </SecondaryButton>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function PlansSection({
  title,
  plans,
  variant,
  onChanged,
}: {
  title: string;
  plans: PlanItem[];
  variant?: "default" | "attention";
  onChanged: () => void;
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-2 space-y-3">
        {plans.map((p) => (
          <PlanCard key={p.meetup_id} plan={p} onChanged={onChanged} variant={variant} />
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-1 text-sm font-semibold text-charcoal">{children}</h3>
  );
}

function groupLabel(k: "today" | "tomorrow" | "this_week" | "later") {
  switch (k) {
    case "today": return "Today";
    case "tomorrow": return "Tomorrow";
    case "this_week": return "This week";
    case "later": return "Later";
  }
}
