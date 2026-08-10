import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Calendar,
  ChevronRight,
  HeartHandshake,
  Info,
  Leaf,
  MapPin,
  RefreshCw,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import { AppHeader, Card, EmptyState, LoadingSkeleton, PrimaryButton, SecondaryButton, UserAvatar, BackButton } from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMyCommunityImpact,
  fetchMyImpactHistory,
  formatOccurredAt,
  hydrateSubjects,
  firstName,
  type ImpactActivity,
  type ImpactActivityType,
  type ImpactSubject,
} from "@/lib/communityImpact";
import { cn } from "@/lib/utils";

type Tab = "overview" | "veggies" | "places" | "meetups" | "history";

const TAB_TO_TYPE: Record<Exclude<Tab, "overview" | "history">, ImpactActivityType> = {
  veggies: "verified_connection",
  places: "place_supported",
  meetups: "meetup_hosted",
};

export default function Impact() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const routeParams = useParams<{ tab?: string }>();
  const allowed: Tab[] = ["overview", "veggies", "places", "meetups", "history"];
  const routeTab = allowed.includes((routeParams.tab as Tab) ?? ("" as Tab)) ? (routeParams.tab as Tab) : undefined;
  const tab: Tab = routeTab ?? ((params.get("tab") as Tab) || "overview");
  const setTab = (t: Tab) => {
    if (routeTab) {
      navigate(t === "overview" ? "/impact" : `/impact/${t}`, { replace: true });
    } else {
      setParams(t === "overview" ? {} : { tab: t }, { replace: true });
    }
  };

  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["impact-overview", profile?.id],
    enabled: !!profile?.id,
    queryFn: fetchMyCommunityImpact,
    refetchOnWindowFocus: "always",
    staleTime: 30_000,
  });

  // Refresh totals when the tab regains focus, and after relevant tables change.
  useEffect(() => {
    if (!profile?.id) return;
    const ch = supabase
      .channel(`impact-refresh:${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "verified_meetup_connections" }, () =>
        qc.invalidateQueries({ queryKey: ["impact-overview", profile.id] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () =>
        qc.invalidateQueries({ queryKey: ["impact-overview", profile.id] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "meetups" }, () =>
        qc.invalidateQueries({ queryKey: ["impact-overview", profile.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.id, qc]);

  return (
    <>
      <AppHeader
        title="Community Impact"
        left={
          <BackButton fallback="/you" />
        }
      />
      <div className="px-5 pt-2 pb-10 space-y-6">
        <p className="text-sm text-charcoal-muted -mt-1">
          Your real-world activity across VeggieMeet.
        </p>

        <TabBar current={tab} onChange={setTab} />

        {tab === "overview" && (
          <OverviewSection
            loading={overview.isLoading}
            error={overview.isError}
            data={overview.data}
            profileId={profile?.id}
            onViewAll={() => setTab("history")}
            onTab={setTab}
            onRetry={() => overview.refetch()}
          />
        )}

        {tab === "history" && <HistorySection profileId={profile?.id} type={null} title="Your Impact History" />}
        {tab === "veggies" && (
          <HistorySection
            profileId={profile?.id}
            type="verified_connection"
            title="Veggies Met"
            emptyText="No Veggies met yet."
            countLabel={(n) => (n === 1 ? "1 Veggie met in real life" : `${n} Veggies met in real life`)}
            total={overview.data?.veggies_met}
          />
        )}
        {tab === "places" && (
          <HistorySection
            profileId={profile?.id}
            type="place_supported"
            title="Community Places Supported"
            emptyText="No Community Places supported yet."
            countLabel={(n) => (n === 1 ? "1 Community Place supported" : `${n} Community Places supported`)}
            total={overview.data?.community_places_supported}
          />
        )}
        {tab === "meetups" && (
          <HistorySection
            profileId={profile?.id}
            type="meetup_hosted"
            title="Meetups Hosted"
            emptyText="No completed Meetups hosted yet."
            countLabel={(n) => (n === 1 ? "1 completed Meetup hosted" : `${n} completed Meetups hosted`)}
            total={overview.data?.meetups_hosted}
          />
        )}

        {tab === "overview" && <HowItWorks />}
      </div>
    </>
  );
}

/* ------------------------------ Tab Bar ------------------------------ */

function TabBar({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const items: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "veggies", label: "Veggies" },
    { key: "places", label: "Places" },
    { key: "meetups", label: "Hosted" },
    { key: "history", label: "History" },
  ];
  return (
    <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" role="tablist">
      {items.map((it) => {
        const active = current === it.key;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-soft"
                : "bg-muted text-charcoal-muted hover:bg-muted/70",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ Overview ------------------------------ */

function OverviewSection({
  loading,
  error,
  data,
  profileId,
  onViewAll,
  onTab,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  data?: Awaited<ReturnType<typeof fetchMyCommunityImpact>>;
  profileId?: string;
  onViewAll: () => void;
  onTab: (t: Tab) => void;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const navigateToSupported = () =>
    navigate("/you/places-supported?from=community_impact");
  if (error) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-sm text-charcoal">We couldn't load your Community Impact.</p>
        <div className="mt-3 flex justify-center">
          <PrimaryButton size="sm" onClick={onRetry}>
            <RefreshCw className="w-4 h-4" />
            Try Again
          </PrimaryButton>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton className="h-28" />
        <LoadingSkeleton className="h-28" />
        <LoadingSkeleton className="h-28" />
      </div>
    );
  }

  const v = data?.veggies_met ?? 0;
  const p = data?.community_places_supported ?? 0;
  const h = data?.meetups_hosted ?? 0;
  const hasAny = v + p + h > 0;

  if (!hasAny) {
    return (
      <EmptyImpactState />
    );
  }

  return (
    <div className="space-y-4">
      <MetricCard
        icon={<Users className="w-5 h-5" />}
        title="Veggies Met"
        total={v}
        description={
          v === 1 ? "You met 1 Veggie in real life." : `You met ${v} Veggies in real life.`
        }
        onView={() => onTab("veggies")}
      />
      <MetricCard
        icon={<Leaf className="w-5 h-5" />}
        title="Community Places Supported"
        total={p}
        description={
          p === 1 ? "You supported 1 Community Place." : `You supported ${p} Community Places.`
        }
        onView={() => navigateToSupported()}
        viewLabel="View Places You’ve Supported"
      />
      <MetricCard
        icon={<Sparkles className="w-5 h-5" />}
        title="Meetups Hosted"
        total={h}
        description={
          h === 1
            ? "You hosted 1 completed Meetup."
            : `You hosted ${h} completed Meetups.`
        }
        onView={() => onTab("meetups")}
      />

      <RecentImpact
        profileId={profileId}
        activities={data?.recent_activity ?? []}
        onViewAll={onViewAll}
      />
    </div>
  );
}

function MetricCard({
  icon,
  title,
  total,
  description,
  onView,
  viewLabel,
}: {
  icon: JSX.Element;
  title: string;
  total: number;
  description: string;
  onView: () => void;
  viewLabel?: string;
}) {
  return (
    <Card padding="lg">
      <button
        type="button"
        onClick={onView}
        aria-label={viewLabel ?? `View ${title} details`}
        className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center shrink-0"
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider font-semibold text-charcoal-muted">
              {title}
            </div>
            <div className="mt-0.5 text-3xl font-bold text-charcoal leading-none tabular-nums">
              {total}
            </div>
            <p className="mt-1.5 text-sm text-charcoal-muted">{description}</p>
          </div>
        </div>
      </button>
      <div className="mt-4">
        <SecondaryButton size="sm" fullWidth onClick={onView} aria-label={viewLabel ?? `View ${title} details`}>
          {viewLabel ? "View Places" : "View Details"}
          <ChevronRight className="w-4 h-4" />
        </SecondaryButton>
      </div>
    </Card>
  );
}


/* --------------------------- Recent Impact --------------------------- */

function RecentImpact({
  profileId,
  activities,
  onViewAll,
}: {
  profileId?: string;
  activities: ImpactActivity[];
  onViewAll: () => void;
}) {
  const [subjects, setSubjects] = useState<ImpactSubject | null>(null);
  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    hydrateSubjects(activities, profileId).then((s) => {
      if (alive) setSubjects(s);
    });
    return () => {
      alive = false;
    };
  }, [profileId, activities]);

  return (
    <section aria-labelledby="recent-impact-heading">
      <div className="flex items-baseline justify-between px-1 mb-2">
        <h3 id="recent-impact-heading" className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
          Recent Impact
        </h3>
        {activities.length > 0 && (
          <button
            onClick={onViewAll}
            className="text-xs font-medium text-primary hover:underline"
          >
            View Full History
          </button>
        )}
      </div>
      {activities.length === 0 ? (
        <Card className="text-sm text-charcoal-muted text-center">
          Your first meaningful activity will appear here.
        </Card>
      ) : (
        <Card padding="none" className="divide-y divide-border/70 overflow-hidden">
          {activities.map((a) => (
            <ActivityRow key={a.id} activity={a} subjects={subjects} />
          ))}
        </Card>
      )}
    </section>
  );
}

/* ------------------------------ History ------------------------------ */

function HistorySection({
  profileId,
  type,
  title,
  emptyText,
  countLabel,
  total,
}: {
  profileId?: string;
  type: ImpactActivityType | null;
  title: string;
  emptyText?: string;
  countLabel?: (n: number) => string;
  total?: number;
}) {
  const query = useInfiniteQuery({
    queryKey: ["impact-history", profileId, type ?? "all"],
    enabled: !!profileId,
    initialPageParam: { cursor: null as string | null, cursorId: null as string | null },
    queryFn: ({ pageParam }) =>
      fetchMyImpactHistory({
        cursor: (pageParam as any).cursor,
        cursorId: (pageParam as any).cursorId,
        limit: 20,
        type,
      }),
    getNextPageParam: (last) =>
      last.has_more ? { cursor: last.next_cursor, cursorId: last.next_cursor_id } : undefined,
  });

  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.items),
    [query.data],
  );

  const [subjects, setSubjects] = useState<ImpactSubject | null>(null);
  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    hydrateSubjects(items, profileId).then((s) => {
      if (alive) setSubjects(s);
    });
    return () => {
      alive = false;
    };
  }, [items, profileId]);

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <LoadingSkeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-sm text-charcoal">We couldn't load your Community Impact.</p>
        <div className="mt-3 flex justify-center">
          <PrimaryButton size="sm" onClick={() => query.refetch()}>
            <RefreshCw className="w-4 h-4" /> Try Again
          </PrimaryButton>
        </div>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-sm text-charcoal-muted">{emptyText ?? "Nothing here yet."}</p>
      </Card>
    );
  }

  return (
    <section aria-labelledby="history-heading">
      <div className="px-1 mb-2">
        <h3 id="history-heading" className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
          {title}
        </h3>
        {countLabel && typeof total === "number" && (
          <p className="mt-0.5 text-sm text-charcoal-muted">{countLabel(total)}</p>
        )}
      </div>
      <Card padding="none" className="divide-y divide-border/70 overflow-hidden">
        {items.map((a) => (
          <ActivityRow key={a.id} activity={a} subjects={subjects} />
        ))}
      </Card>
      {query.hasNextPage && (
        <div className="mt-3 flex justify-center">
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
  );
}

/* --------------------------- Activity row --------------------------- */

function RowShell({
  primaryHref,
  primaryLabel,
  disabled,
  icon,
  children,
}: {
  primaryHref?: string;
  primaryLabel: string;
  disabled?: boolean;
  icon: JSX.Element;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const interactive = !!primaryHref && !disabled;
  return (
    <article className="relative p-4 flex items-center gap-3 group focus-within:bg-muted/40 hover:bg-muted/40 transition-colors">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">{children}</div>
      {interactive && (
        <>
          <a
            href={primaryHref}
            aria-label={primaryLabel}
            onClick={(e) => {
              e.preventDefault();
              navigate(primaryHref!);
            }}
            className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
          <ChevronRight className="w-4 h-4 text-charcoal-muted shrink-0" aria-hidden />
        </>
      )}
    </article>
  );
}

function ActivityRow({
  activity,
  subjects,
}: {
  activity: ImpactActivity;
  subjects: ImpactSubject | null;
}) {
  const navigate = useNavigate();
  const date = formatOccurredAt(activity.occurred_at);

  if (activity.activity_type === "verified_connection") {
    const peerId = activity.subject_profile_id ?? "";
    const peer = subjects?.profiles[peerId];
    const blocked = subjects?.blockedPeers.has(peerId);
    const meetup = activity.subject_meetup_id
      ? subjects?.meetups[activity.subject_meetup_id]
      : undefined;
    const canOpenProfile = !blocked && !!peer;

    return (
      <RowShell
        primaryHref={canOpenProfile ? `/veggie/${peerId}` : undefined}
        primaryLabel={`View ${peer?.display_name ?? "Veggie"}'s profile`}
        disabled={!canOpenProfile}
        icon={
          <UserAvatar
            name={peer?.display_name ?? "Veggie"}
            src={peer?.avatar_url ?? undefined}
            size="md"
          />
        }
      >
        <div className="text-sm text-charcoal">
          <span className="font-semibold">
            {blocked
              ? "You met a Veggie in real life."
              : `You met ${firstName(peer?.display_name)} in real life.`}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-charcoal-muted flex-wrap">
          <span className="inline-flex items-center gap-1 text-primary">
            <ShieldVerifiedIcon />
            Verified
          </span>
          <span aria-hidden>·</span>
          <span>{date}</span>
          {meetup && (
            <>
              <span aria-hidden>·</span>
              <a
                href={`/meetup/${meetup.id}/summary`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/meetup/${meetup.id}/summary`);
                }}
                className="relative z-10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {meetup.title}
              </a>
            </>
          )}
        </div>
        {blocked && (
          <div className="mt-1 text-[11px] text-charcoal-muted">Profile unavailable</div>
        )}
      </RowShell>
    );
  }

  if (activity.activity_type === "place_supported") {
    const placeId = activity.subject_place_id ?? "";
    const place = subjects?.places[placeId];
    const meetup = activity.subject_meetup_id
      ? subjects?.meetups[activity.subject_meetup_id]
      : undefined;
    const available = !!place;

    return (
      <RowShell
        primaryHref={available ? `/place/${placeId}` : undefined}
        primaryLabel={`View ${place?.name ?? "Community Place"}`}
        disabled={!available}
        icon={
          <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        }
      >
        <div className="text-sm font-semibold text-charcoal">
          You supported {place?.name ?? "a Community Place"}.
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-charcoal-muted flex-wrap">
          <span>{date}</span>
          {meetup && (
            <>
              <span aria-hidden>·</span>
              <a
                href={`/meetup/${meetup.id}/summary`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/meetup/${meetup.id}/summary`);
                }}
                className="relative z-10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {meetup.title}
              </a>
            </>
          )}
        </div>
        {!available && (
          <div className="mt-1 text-[11px] text-charcoal-muted">Place no longer available</div>
        )}
      </RowShell>
    );
  }

  // meetup_hosted
  const meetupId = activity.subject_meetup_id ?? "";
  const meetup = subjects?.meetups[meetupId];
  const place = meetup?.community_place_id
    ? subjects?.places[meetup.community_place_id]
    : undefined;
  const available = !!meetup;

  return (
    <RowShell
      primaryHref={available ? `/meetup/${meetupId}/summary` : undefined}
      primaryLabel={`View ${meetup?.title ?? "Meetup"} summary`}
      disabled={!available}
      icon={
        <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
          <Calendar className="w-5 h-5" />
        </div>
      }
    >
      <div className="text-sm font-semibold text-charcoal">
        You hosted {meetup?.title ?? "a Meetup"}.
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-charcoal-muted flex-wrap">
        <span>{date}</span>
        {(place?.name || meetup?.custom_location_name) && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {place?.name ?? meetup?.custom_location_name}
            </span>
          </>
        )}
      </div>
    </RowShell>
  );
}

function ShieldVerifiedIcon() {
  return <HeartHandshake className="w-3 h-3" aria-hidden />;
}

/* ------------------------------ Empty state ------------------------------ */

function EmptyImpactState() {
  const navigate = useNavigate();
  return (
    <Card padding="lg">
      <div className="text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
          <HeartHandshake className="w-6 h-6" />
        </div>
        {/* WO-085A DEF-085A-04: h2 keeps this one level below the page h1. */}
        <h2 className="mt-4 text-base font-semibold text-charcoal">
          Your Community Impact starts here.
        </h2>
        <p className="mt-1 text-sm text-charcoal-muted max-w-xs mx-auto">
          Meet Veggies, support Community Places, or host a Meetup to begin building your
          real-world impact.
        </p>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-2">
        <PrimaryButton size="sm" onClick={() => navigate("/community")}>
          <UserPlus className="w-4 h-4" /> Discover Veggies
        </PrimaryButton>
        <SecondaryButton size="sm" onClick={() => navigate("/community")}>
          <Leaf className="w-4 h-4" /> Explore Places
        </SecondaryButton>
        <SecondaryButton size="sm" onClick={() => navigate("/")}>
          <Calendar className="w-4 h-4" /> Find a Meetup
        </SecondaryButton>
      </div>
    </Card>
  );
}

/* ------------------------------ How it works ------------------------------ */

function HowItWorks() {
  return (
    <Card padding="lg">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-soft-green text-primary flex items-center justify-center shrink-0">
          <Info className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-charcoal">How Impact works</h3>
          <p className="mt-1 text-sm text-charcoal-muted leading-relaxed">
            Community Impact reflects real activity: meeting Veggies in person, supporting
            Community Places, and hosting completed Meetups. Repeated scans and invalid activity
            do not increase your totals.
          </p>
          <p className="mt-2 text-xs text-charcoal-muted">
            Your detailed activity history is private to you.
          </p>
        </div>
      </div>
    </Card>
  );
}
