import { useEffect, useMemo, useState } from "react";
import { logAnalyticsEvent } from "@/lib/analytics";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Calendar,
  ChevronRight,
  Clock,
  Handshake,
  Home,
  Leaf,
  MapPin,
  Pencil,
  ShieldCheck,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import { useMyCollection } from "@/hooks/useCollection";
import { profileLevel, type Collection as CollectionData } from "@/lib/collection";
import { LevelRing } from "@/components/collection/LevelRing";
import { CollectionPanel } from "@/components/collection/CollectionPanel";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { Stagger } from "@/components/app/Stagger";
import { AnimatedNumber } from "@/components/app/AnimatedNumber";
import { fireConfetti, takeLevelUp } from "@/lib/celebrations";
import { TestModeToggle } from "@/components/app/TestMode";
import {
  AppHeader,
  Card,
  EmptyState,
  MeetupCard,
  MeetupCardSkeleton,
  NotificationsBell,
  PrimaryButton,
  SecondaryButton,
  ThemeToggle,
  UserAvatar,
} from "@/components/app";

import { useAuth } from "@/hooks/useAuth";
import { todayISO } from "@/lib/todayDate";
import { toMeetupCardShape } from "@/lib/youSummary";
import type { YouHistoryItem, YouMeetupCard } from "@/lib/youSummary";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isOwner } from "@/lib/placeVerification";
import { useRealtimeEpoch } from "@/hooks/useRealtimeEpoch";


type Tab = "hosting" | "going" | "past";

export default function You() {
  const navigate = useNavigate();

  // WO-084A: surface view event (mount-only, deduped by the logger).
  useEffect(() => {
    logAnalyticsEvent("you_opened", {});
  }, []);
  const { profile, loading, signOut, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("hosting");
  

  // WO-087: one bounded, self-scoped RPC replaces the previous five direct
  // meetups/attendance reads (hosting, going, past ×3 sub-reads).
  const summaryQuery = useQuery({
    queryKey: ["my-you-summary", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => import("@/lib/youSummary").then((m) => m.fetchMyYouSummary()),
  });

  const impactQuery = useQuery({
    queryKey: ["me-impact-overview", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => import("@/lib/communityImpact").then((m) => m.fetchMyCommunityImpact()),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });

  // Collection (level, stickers, cards, badges) shown inline on the profile.
  const collectionQuery = useMyCollection(!!profile?.id);

  // WO-101B: owner-only Community Place operations entry point.
  // Resolved from the same server-side owner allowlist used by RequireOwner.
  const ownerQuery = useQuery({
    queryKey: ["you-is-owner"],
    queryFn: isOwner,
    staleTime: 5 * 60 * 1000,
  });

  const qc = useQueryClient();
  // WO-145R — re-subscribe once when a cancelled update restores live updates.
  const realtimeEpoch = useRealtimeEpoch();
  useEffect(() => {
    if (!profile?.id) return;
    // Shared invalidation: attendance / meetup lifecycle / verified connection
    // changes refresh both Community Impact and the /you Meetup summary.
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["me-impact-overview", profile.id] });
      qc.invalidateQueries({ queryKey: ["my-you-summary", profile.id] });
      qc.invalidateQueries({ queryKey: ["collection"] });
    };
    const channel = supabase
      .channel(`impact:${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "verified_meetup_connections" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetups" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetup_completions" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc, realtimeEpoch]);

  const hostedCount = summaryQuery.data?.counts.hosting_upcoming ?? 0;
  const isActiveHost = hostedCount > 0 || profile?.is_active_host;

  // WO-113: "Veggie since <month year>" removed from the member-facing profile.
  // It was derived from profiles.created_at (no dedicated column); no schema or
  // data change was needed and no other surface consumed it.


  if (loading) {
    return (
      <>
        <AppHeader title="My Profile" />
        <div className="px-5 mt-2 space-y-4">
          <Card className="h-40 animate-pulse" />
          <Card className="h-24 animate-pulse" />
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <AppHeader title="My Profile" />
        <EmptyState
          title="We couldn't load your profile."
          description="Give it another try, or sign out and back in."
          action={
            <div className="flex flex-col gap-2 w-full">
              <PrimaryButton onClick={() => refreshProfile()}>Try again</PrimaryButton>
              <SecondaryButton onClick={() => signOut().then(() => navigate("/onboarding"))}>
                Sign out
              </SecondaryButton>
            </div>
          }
        />
      </>
    );
  }


  return (
    <>
      <AppHeader
        title="My Profile"
        right={
          <>
            {ownerQuery.data === true && <TestModeToggle />}
            <ThemeToggle />
            <NotificationsBell />
            <button
              onClick={() => navigate("/settings")}
              aria-label="Open Settings"
              className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </>
        }
      />

      <div className="px-5 mt-2 pb-8 space-y-8">
        {/* Identity */}
        <Card className="flex flex-col items-center text-center">
          <UserAvatar
            name={profile.display_name}
            src={profile.avatar_url ?? undefined}
            size="xl"
          />
          {/* WO-085A DEF-085A-11 (WCAG 1.4.10): long unbroken display names
              must wrap instead of forcing horizontal scroll at 320 CSS px. */}
          <h2 className="mt-3 text-xl font-semibold text-charcoal [overflow-wrap:anywhere] max-w-full">
            {profile.display_name}
          </h2>
          {profile.current_city && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-charcoal-muted">
              <MapPin className="w-3.5 h-3.5" />
              {profile.current_city}
            </p>
          )}
          {profile.bio && (
            <p className="mt-3 text-sm text-charcoal leading-relaxed max-w-xs">
              {profile.bio}
            </p>
          )}
          {isActiveHost && (
            <span className="mt-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-charcoal-muted">
              <Sparkles className="w-2.5 h-2.5" />
              Active Host
            </span>
          )}



          {/* WO-113A: wrap instead of a fixed 2-up row so both actions keep
              their full label at 200% text zoom without horizontal overflow. */}
          <div className="mt-5 flex w-full flex-wrap gap-2 [&>*]:min-w-0 [&>*]:flex-1 [&>*]:basis-[8rem]">
            <PrimaryButton
              size="sm"
              fullWidth
              onClick={() => navigate("/you/edit")}
            >
              <Pencil className="w-4 h-4" />
              Edit Profile
            </PrimaryButton>
            <SecondaryButton
              size="sm"
              fullWidth
              onClick={() =>
                toast("Sharing profiles is coming soon", {
                  description: "You'll be able to share your Veggie profile in a future update.",
                })
              }
            >
              <Share2 className="w-4 h-4" />
              Share
            </SecondaryButton>
          </div>
        </Card>

        {/* Level + Community Impact (combined per Justin, 2026-11-23) */}
        <LevelImpactCard
          collection={collectionQuery.data}
          collectionLoading={collectionQuery.isPending}
          impactLoading={impactQuery.isLoading}
          veggiesMet={impactQuery.data?.veggies_met ?? 0}
          placesSupported={impactQuery.data?.community_places_supported ?? 0}
          meetupsHosted={impactQuery.data?.meetups_hosted ?? 0}
          onViewImpact={() => navigate("/impact")}
        />

        {/* Collection, inline on the profile (stickers / cards / badges) */}
        <section aria-label="My collection">
          {collectionQuery.isPending ? (
            <Card className="h-40 animate-pulse" />
          ) : collectionQuery.isError || !collectionQuery.data ? (
            <Card padding="lg" className="text-center space-y-3">
              <p className="text-sm text-charcoal">We couldn't load your collection just now.</p>
              <SecondaryButton size="sm" onClick={() => collectionQuery.refetch()}>
                Try again
              </SecondaryButton>
            </Card>
          ) : (
            <CollectionPanel
              data={collectionQuery.data}
              isSelf
              firstName={profile.display_name.split(/\s+/)[0] || "You"}
              showHowPoints={false}
            />
          )}
        </section>

        {/* My meetups: Hosting / Going / Past in one switcher (Justin, 2026-11-23) */}
        <section>
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
            My meetups
          </h3>
          <SegmentedTabs<Tab>
            className="mb-3"
            ariaLabel="My meetups"
            items={[
              { key: "hosting", label: "Hosting" },
              { key: "going", label: "Going" },
              { key: "past", label: "Past" },
            ]}
            value={tab}
            onChange={setTab}
          />

          {summaryQuery.isError ? (
            <SummaryError onRetry={() => summaryQuery.refetch()} />
          ) : (
            <div key={tab} className="motion-safe:animate-tab-in">
              {tab === "hosting" && (
                <MeetupList
                  loading={summaryQuery.isLoading}
                  cards={summaryQuery.data?.hosting ?? []}
                  profileId={profile.id}
                  role="host"
                  emptyTitle="Host your first meetup"
                  emptyDescription="Bring Veggies together around something you enjoy."
                  emptyIcon={<Users className="w-6 h-6" />}
                  emptyAction={
                    <PrimaryButton onClick={() => navigate("/host")}>
                      Host a Meetup
                    </PrimaryButton>
                  }
                />
              )}
              {tab === "going" && (
                <MeetupList
                  loading={summaryQuery.isLoading}
                  cards={summaryQuery.data?.going ?? []}
                  profileId={profile.id}
                  role="attendee"
                  emptyTitle="Find your next meetup"
                  emptyDescription="Discover something happening near you."
                  emptyIcon={<Calendar className="w-6 h-6" />}
                  emptyAction={
                    <PrimaryButton onClick={() => navigate("/community")}>
                      Explore Meetups
                    </PrimaryButton>
                  }
                />
              )}
              {tab === "past" && (
                <PastMeetupsList
                  loading={summaryQuery.isLoading}
                  items={summaryQuery.data?.history ?? []}
                  hasMore={summaryQuery.data?.history_has_more ?? false}
                  onViewAll={() => navigate("/plans")}
                />
              )}
            </div>
          )}
        </section>

        {/* WO-101B: owner-only Community Place operations entry */}
        {ownerQuery.data === true && (
          <Card
            interactive
            padding="md"
            tabIndex={0}
            aria-label="Open Community Place operations"
            onClick={() => {
              logAnalyticsEvent("owner_community_place_operations_opened", {
                source: "you",
              });
              navigate("/owner/places");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                logAnalyticsEvent("owner_community_place_operations_opened", {
                  source: "you",
                });
                navigate("/owner/places");
              }
            }}
            className="flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-card bg-soft-green text-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-charcoal">
                Community Place operations
              </div>
              <div className="text-xs text-charcoal-muted">
                Manage verified places and owner tools
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
          </Card>
        )}


        {/* Interests */}
        <section>
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
            Interests
          </h3>
          {profile.interests && profile.interests.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.interests.map((i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-soft-green text-primary border border-primary/10"
                >
                  {i}
                </span>
              ))}
            </div>
          ) : (
            <Card className="text-sm text-charcoal-muted text-center">
              You haven't picked any interests yet.
            </Card>
          )}
        </section>

      </div>



      {/* WO-146: the intermediary Settings sheet was removed. The gear now
          navigates straight to the canonical /settings screen; Edit Profile
          keeps its prominent button above, Safety & Trust lives only under
          Settings → Trust & policies, and Sign out lives in Settings →
          Account. */}
    </>
  );
}

/* ---------- Small building blocks ---------- */

function LevelImpactCard({
  collection,
  collectionLoading,
  impactLoading,
  veggiesMet,
  placesSupported,
  meetupsHosted,
  onViewImpact,
}: {
  collection: CollectionData | undefined;
  collectionLoading: boolean;
  impactLoading: boolean;
  veggiesMet: number;
  placesSupported: number;
  meetupsHosted: number;
  onViewImpact: () => void;
}) {
  const level = useMemo(
    () => (collection ? profileLevel(collection.stickers, collection.stats) : null),
    [collection],
  );
  const zero = !impactLoading && veggiesMet === 0 && placesSupported === 0 && meetupsHosted === 0;
  // Level-up moment: once per device when the level is higher than last seen.
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!collection || !level) return;
    if (takeLevelUp(collection.profile_id, level.level)) {
      setCelebrate(true);
      fireConfetti({ origin: { x: 0.5, y: 0.3 }, count: 90 });
      toast.success(`Level ${level.level} · ${level.name}`, {
        description: "You levelled up. Keep collecting!",
        duration: 6000,
      });
      const t = window.setTimeout(() => setCelebrate(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [collection, level]);
  return (
    <section aria-labelledby="level-impact-title">
      <Card padding="lg" className="space-y-5">
        {/* Level */}
        <div className="flex items-center gap-4">
          {level ? (
            <div className={cn("relative", celebrate && "motion-safe:animate-pop")}>
              {celebrate && (
                <span className="absolute inset-0 rounded-full bg-primary/30 motion-safe:animate-ring-ping" aria-hidden />
              )}
              <LevelRing level={level} size={64} />
            </div>
          ) : (
            <div className={cn("w-16 h-16 rounded-full bg-muted", collectionLoading && "animate-pulse")} aria-hidden />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-charcoal-muted">
              {level ? `Level ${level.level}` : "Level"}
            </div>
            <h3 id="level-impact-title" className="text-lg font-semibold text-charcoal leading-tight">
              {level ? level.name : collectionLoading ? "…" : "Sprout"}
            </h3>
            <div className="mt-1 text-xs text-charcoal-muted">
              {level ? (
                <>
                  <AnimatedNumber value={level.points} /> pts ·{" "}
                  {level.nextMin ? `${level.nextMin - level.points} to level ${level.level + 1}` : "top level"}
                </>
              ) : (
                "Earn points by visiting places, joining meetups and meeting Veggies."
              )}
            </div>
            {level && (
              <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(level.progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>

        {/* Community Impact */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Leaf className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold text-charcoal tracking-tight">Community Impact</h4>
          </div>
          <button
            type="button"
            onClick={onViewImpact}
            className="min-h-11 px-2 -mr-2 inline-flex items-center text-xs font-medium text-primary hover:underline"
            aria-label="Open Community Impact"
          >
            View
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ImpactMetric
            icon={<Handshake className="w-4 h-4" />}
            label="Veggies Met"
            value={impactLoading ? "—" : veggiesMet}
          />
          <ImpactMetric
            icon={<Home className="w-4 h-4" />}
            label="Places Supported"
            value={impactLoading ? "—" : placesSupported}
          />
          <ImpactMetric
            icon={<Sparkles className="w-4 h-4" />}
            label="Meetups Hosted"
            value={impactLoading ? "—" : meetupsHosted}
          />
        </div>
        {/* WO-095 §9: at zero, bare zeros read as failure — explain how impact
            is earned instead. */}
        <p className="text-[11px] text-charcoal-muted leading-relaxed">
          {zero
            ? "Your impact grows as you meet Veggies in person, verify visits at veggie places, and host Meetups."
            : "See the people, places, and Meetups you've supported, and your Veggie Network."}
        </p>
      </Card>
    </section>
  );
}

function ImpactMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-card bg-soft-green/60 p-5">
      <div className="text-3xl font-bold text-charcoal tabular-nums leading-none">
        <AnimatedNumber value={value} />
      </div>
      {/* DEF-092A-10: in the 3-up grid the flex row squeezed the 16px icons to a
          1-2px sliver, which read as a broken glyph. The icon keeps its size and
          the label wraps instead. */}
      <div className="mt-2.5 flex items-start gap-1.5 text-[11px] font-semibold text-primary leading-tight">
        <span className="shrink-0 [&_svg]:w-4 [&_svg]:h-4">{icon}</span>
        <span className="min-w-0">{label}</span>
      </div>

    </div>
  );
}

function SummaryError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card padding="lg" className="text-center space-y-3">
      <p className="text-sm text-charcoal">
        We couldn't load your Meetups just now.
      </p>
      <SecondaryButton size="sm" onClick={onRetry}>
        Try again
      </SecondaryButton>
    </Card>
  );
}

function MeetupList({
  loading,
  cards,
  profileId,
  role,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
}: {
  loading: boolean;
  cards: YouMeetupCard[];
  profileId: string;
  role: "host" | "attendee";
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon: React.ReactNode;
  emptyAction: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <MeetupCardSkeleton />
        <MeetupCardSkeleton />
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      </Card>
    );
  }
  return (
    <Stagger className="space-y-3">
      {cards.map((c) => (
        <div key={c.meetup_id}>
          <div className="mb-1 px-1 flex items-center gap-1 text-[11px] font-medium text-charcoal-muted">
            <Clock className="w-3 h-3" />
            {formatShortDate(c.date)}
          </div>
          <MeetupCard meetup={toMeetupCardShape(c, profileId)} role={role} />
        </div>
      ))}
    </Stagger>
  );
}


function formatShortDate(iso: string) {
  if (iso === todayISO()) return "Today";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}


function PastMeetupsList({
  loading,
  items,
  hasMore,
  onViewAll,
}: {
  loading: boolean;
  items: YouHistoryItem[];
  hasMore: boolean;
  onViewAll: () => void;
}) {
  const navigate = useNavigate();
  if (loading) return <Card className="h-24 animate-pulse" />;
  if (items.length === 0) {
    return (
      <Card padding="lg" className="text-center text-sm text-charcoal-muted">
        No past Meetups yet.
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      <Card padding="none">
        <ul className="divide-y divide-border/60">
          {items.map((m) => (
            <li key={m.meetup_id}>
              <button
                onClick={() => navigate(`/meetup/${m.meetup_id}/summary`)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-charcoal truncate">
                      {m.title}
                    </span>
                    {m.cancelled && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-charcoal-muted">
                        Cancelled
                      </span>
                    )}
                    {m.is_host && !m.cancelled && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-host-badge/25 text-charcoal">
                        Hosted
                      </span>
                    )}
                    {!m.is_host && (m.attendance_status === "checked_in" || m.attendance_status === "attended") && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-soft-green text-primary">
                        Checked in
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-charcoal-muted mt-0.5">
                    {new Date(m.date + "T00:00:00").toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-charcoal-muted" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {hasMore && (
        <button type="button" onClick={onViewAll} className="px-1 text-xs font-semibold text-primary">
          See all past meetups
        </button>
      )}
    </div>
  );
}
