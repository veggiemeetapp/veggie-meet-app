import { useEffect, useMemo, useState } from "react";
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
  LogOut,
  MapPin,
  Pencil,
  ShieldCheck,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  MeetupCard,
  MeetupCardSkeleton,
  NotificationsBell,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchAttendingMeetups,
  fetchHostedMeetups,
} from "@/lib/backend";
import { TODAY_ISO } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Meetup } from "@/types";

type Tab = "hosting" | "going";

export default function You() {
  const navigate = useNavigate();
  const { profile, loading, signOut, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("hosting");
  const [menuOpen, setMenuOpen] = useState(false);

  const hostingQuery = useQuery({
    queryKey: ["me-hosting", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => fetchHostedMeetups(profile!.id, TODAY_ISO),
  });

  const goingQuery = useQuery({
    queryKey: ["me-going", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => fetchAttendingMeetups(profile!.id, TODAY_ISO),
  });

  const impactQuery = useQuery({
    queryKey: ["me-impact-overview", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => import("@/lib/communityImpact").then((m) => m.fetchMyCommunityImpact()),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });

  const qc = useQueryClient();
  useEffect(() => {
    if (!profile?.id) return;
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: ["me-impact-overview", profile.id] });
    const channel = supabase
      .channel(`impact:${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "verified_meetup_connections" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetups" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc]);

  const hostedCount = hostingQuery.data?.length ?? 0;
  const isActiveHost = hostedCount > 0 || profile?.is_active_host;

  const memberSince = useMemo(() => {
    const created = (profile as unknown as { created_at?: string } | null)?.created_at;
    if (!created) return null;
    return new Date(created).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }, [profile]);

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

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    navigate("/onboarding", { replace: true });
  }

  return (
    <>
      <AppHeader
        title="My Profile"
        right={
          <>
            <NotificationsBell />
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Profile settings"
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
          <h2 className="mt-3 text-xl font-semibold text-charcoal">
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
          {memberSince && (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-charcoal-muted">
              Veggie since {memberSince}
            </p>
          )}

          <div className="mt-5 flex w-full gap-2">
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

        {/* Veggie Network entry */}
        <Card
          interactive
          padding="md"
          onClick={() => navigate("/network")}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-charcoal">
              Veggie Network
            </div>
            <div className="text-xs text-charcoal-muted">
              Connections you've made across VeggieMeet
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
        </Card>

        {/* My Plans entry */}
        <Card
          interactive
          padding="md"
          onClick={() => navigate("/plans")}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-charcoal">My Plans</div>
            <div className="text-xs text-charcoal-muted">
              Everything you've committed to
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
        </Card>


        {/* Community Impact entry */}
        <CommunityImpactCard
          loading={impactQuery.isLoading}
          veggiesMet={impactQuery.data?.veggies_met ?? 0}
          placesSupported={impactQuery.data?.community_places_supported ?? 0}
          meetupsHosted={impactQuery.data?.meetups_hosted ?? 0}
          onView={() => navigate("/impact")}
        />

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

        {/* My meetups */}
        <section>
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
            My meetups
          </h3>
          <div className="flex p-1 bg-muted rounded-full mb-3">
            <TabButton active={tab === "hosting"} onClick={() => setTab("hosting")}>
              Hosting
            </TabButton>
            <TabButton active={tab === "going"} onClick={() => setTab("going")}>
              Going
            </TabButton>
          </div>

          {tab === "hosting" && (
            <MeetupList
              loading={hostingQuery.isLoading}
              meetups={hostingQuery.data ?? []}
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
              loading={goingQuery.isLoading}
              meetups={goingQuery.data ?? []}
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
        </section>

        <PastMeetupsSection profileId={profile.id} />
      </div>


      {/* Settings sheet */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-t border-border p-0">
          <SheetHeader className="px-6 pt-6 pb-2 text-left">
            <SheetTitle className="text-lg font-semibold text-charcoal">
              Settings
            </SheetTitle>
            <SheetDescription className="text-sm text-charcoal-muted">
              A full settings experience is coming soon.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pt-3 space-y-1">
            <SheetRow
              icon={<Pencil className="w-5 h-5" />}
              label="Edit Profile"
              onClick={() => {
                setMenuOpen(false);
                navigate("/you/edit");
              }}
            />
            <SheetRow
              icon={<ShieldCheck className="w-5 h-5" />}
              label="Safety & Trust"
              onClick={() => {
                setMenuOpen(false);
                navigate("/safety");
              }}
            />
            <SheetRow
              icon={<SettingsIcon className="w-5 h-5" />}
              label="Settings"
              onClick={() => {
                setMenuOpen(false);
                navigate("/settings");
              }}
            />
          </div>
          <div className="mt-4 border-t border-border px-4 pt-3 pb-6">
            <SheetRow
              icon={<LogOut className="w-5 h-5" />}
              label="Sign Out"
              destructive
              onClick={handleSignOut}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ---------- Small building blocks ---------- */

function CommunityImpactCard({
  loading,
  veggiesMet,
  placesSupported,
  meetupsHosted,
  onView,
}: {
  loading: boolean;
  veggiesMet: number;
  placesSupported: number;
  meetupsHosted: number;
  onView: () => void;
}) {
  return (
    <section aria-labelledby="community-impact-title">
      <Card padding="lg" className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Leaf className="w-4 h-4 text-primary" />
            <h3
              id="community-impact-title"
              className="text-sm font-semibold text-charcoal tracking-tight"
            >
              Community Impact
            </h3>
          </div>
          <button
            type="button"
            onClick={onView}
            className="text-xs font-medium text-primary hover:underline"
            aria-label="Open Community Impact"
          >
            View
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ImpactMetric
            icon={<Handshake className="w-4 h-4" />}
            label="Veggies Met"
            value={loading ? "—" : veggiesMet}
          />
          <ImpactMetric
            icon={<Home className="w-4 h-4" />}
            label="Places Supported"
            value={loading ? "—" : placesSupported}
          />
          <ImpactMetric
            icon={<Sparkles className="w-4 h-4" />}
            label="Meetups Hosted"
            value={loading ? "—" : meetupsHosted}
          />
        </div>
        <p className="text-[11px] text-charcoal-muted leading-relaxed">
          See the people, places, and Meetups you've supported.
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
    <div className="rounded-2xl bg-soft-green/60 p-5">
      <div className="text-3xl font-bold text-charcoal tabular-nums leading-none">
        {value}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-primary leading-tight">
        {icon}
        {label}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 h-9 rounded-full text-sm font-semibold transition-colors",
        active
          ? "bg-card text-charcoal shadow-sm"
          : "text-charcoal-muted hover:text-charcoal"
      )}
    >
      {children}
    </button>
  );
}

function MeetupList({
  loading,
  meetups,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
}: {
  loading: boolean;
  meetups: Meetup[];
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
  if (meetups.length === 0) {
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
    <div className="space-y-3">
      {meetups.map((m) => (
        <div key={m.id}>
          <div className="mb-1 px-1 flex items-center gap-1 text-[11px] font-medium text-charcoal-muted">
            <Clock className="w-3 h-3" />
            {formatShortDate(m.date)}
          </div>
          <MeetupCard meetup={m} />
        </div>
      ))}
    </div>
  );
}

function formatShortDate(iso: string) {
  if (iso === TODAY_ISO) return "Today";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function SheetRow({
  icon,
  label,
  hint,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3.5 rounded-2xl hover:bg-accent/40 active:scale-[0.99] transition text-left",
        destructive ? "text-destructive" : "text-charcoal"
      )}
    >
      <span
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
          destructive ? "bg-destructive/10" : "bg-muted"
        )}
      >
        {icon}
      </span>
      <span className="flex-1 font-semibold">{label}</span>
      {hint && <span className="text-xs text-charcoal-muted">{hint}</span>}
    </button>
  );
}

function PastMeetupsSection({ profileId }: { profileId: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["past-meetups", profileId],
    queryFn: () => import("@/lib/postMeetup").then((m) => m.fetchPastMeetups(profileId)),
  });
  const items = query.data ?? [];
  return (
    <section>
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
        Past Meetups
      </h3>
      {query.isLoading ? (
        <Card className="h-24 animate-pulse" />
      ) : items.length === 0 ? (
        <Card padding="lg" className="text-center text-sm text-charcoal-muted">
          No past Meetups yet.
        </Card>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border/60">
            {items.slice(0, 8).map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => navigate(`/meetup/${m.id}/summary`)}
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
                      {m.isHost && !m.cancelled && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-host-badge/15 text-host-badge">
                          Hosted
                        </span>
                      )}
                      {!m.isHost && (m.attendanceStatus === "checked_in" || m.attendanceStatus === "attended") && (
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
      )}
    </section>
  );
}

