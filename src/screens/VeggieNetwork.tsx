import { safeBack } from "@/lib/navigation";
import { BackButton } from "@/components/app";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Leaf,
  MapPin,
  Search,
  Sprout,
  Handshake,
  Inbox,
  UserPlus,
} from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  LoadingSkeleton,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  fetchMeetNext,
  fetchNetwork,
  type MeetNextCandidate,
  type Relationship,
} from "@/lib/relationships";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Tab = "network" | "requests" | "meet-next";

const TAB_LABEL: Record<Tab, string> = {
  network: "Network",
  requests: "Requests",
  "meet-next": "Meet Next",
};

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

export default function VeggieNetwork() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const initialTab = (params.get("tab") as Tab) || "meet-next";
  const [tab, setTab] = useState<Tab>(
    (["network", "requests", "meet-next"] as Tab[]).includes(initialTab)
      ? initialTab
      : "meet-next",
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(params);
    if (p.get("tab") !== tab) {
      p.set("tab", tab);
      setParams(p, { replace: true });
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const networkQuery = useQuery({
    queryKey: ["veggie-network", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => fetchNetwork(profile!.id),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });

  const meetNextQuery = useQuery({
    // Identity-scoped key — WO-075 cache isolation across account switches.
    queryKey: ["meet-next", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => fetchMeetNext(6),
    staleTime: 60_000,
  });


  // Realtime — refresh both lists when any friendship of mine changes.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`friendships:${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { profile_a_id?: string; profile_b_id?: string }
            | undefined;
          if (
            row &&
            (row.profile_a_id === profile.id || row.profile_b_id === profile.id)
          ) {
            qc.invalidateQueries({ queryKey: ["veggie-network", profile.id] });
            qc.invalidateQueries({ queryKey: ["meet-next", profile.id] });
            qc.invalidateQueries({ queryKey: ["me-impact", profile.id] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc]);

  const data = networkQuery.data;
  const verified = data?.verified ?? [];
  const others = (data?.all ?? []).filter(
    (r) => r.status !== "verified",
  );

  const filterList = (list: Relationship[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const name = r.other.displayName.toLowerCase();
      const city = (r.other.city ?? "").toLowerCase();
      return name.includes(q) || city.includes(q);
    });
  };
  const filteredVerified = useMemo(() => filterList(verified), [verified, query]);
  const filteredOthers = useMemo(() => filterList(others), [others, query]);

  async function handleAccept(r: Relationship) {
    try {
      await acceptRequest(r.id);
      toast.success(`Connected with ${firstName(r.other.displayName)}`);
    } catch {
      toast.error("Couldn't accept just now. Try again.");
    }
  }
  async function handleDecline(r: Relationship) {
    try {
      await declineRequest(r.id);
      toast(`Request declined`);
    } catch {
      toast.error("Couldn't decline just now. Try again.");
    }
  }
  async function handleCancel(r: Relationship) {
    try {
      await cancelRequest(r.id);
      toast(`Request cancelled`);
    } catch {
      toast.error("Couldn't cancel just now. Try again.");
    }
  }

  return (
    <>
      <AppHeader
        title="Veggie Network"
        subtitle="Your connections and new people to meet."
        left={
          <BackButton fallback="/you" />
        }
      />

      <div className="px-5 pt-2 pb-12">
        {/* Tabs */}
        <div className="flex p-1 bg-muted rounded-full">
          {(["network", "requests", "meet-next"] as Tab[]).map((t) => (
            <TabButton
              key={t}
              active={tab === t}
              onClick={() => setTab(t)}
              badge={
                t === "requests" && data && data.incoming.length > 0
                  ? data.incoming.length
                  : undefined
              }
            >
              {TAB_LABEL[t]}
            </TabButton>
          ))}
        </div>

        {tab === "network" && (
          <div className="mt-5 space-y-6">
            {/* Summary */}
            <Card padding="lg" className="grid grid-cols-2 gap-3">
              <SummaryStat
                label="Network"
                value={data?.counts.connections ?? 0}
                hint="Mutually connected"
              />
              <SummaryStat
                label="Verified Connections"
                value={data?.counts.verified ?? 0}
                hint="Met in person"
              />
            </Card>

            {/* Search */}
            <SearchBar value={query} onChange={setQuery} />

            {networkQuery.isLoading ? (
              <Card className="h-32 animate-pulse" />
            ) : (data?.all.length ?? 0) === 0 ? (
              <EmptyState
                icon={<Sprout className="w-6 h-6" />}
                title="No connections yet"
                description="Connections form after you meet someone at a Meetup — that’s what makes them real."
                action={
                  /* WO-095A DEF-095A-02: standard CTA vocabulary — the action
                     is "Meet Veggies", not the name of the tab it opens. */
                  <PrimaryButton onClick={() => setTab("meet-next")}>
                    Meet Veggies
                  </PrimaryButton>
                }
              />
            ) : (
              <>
                {filteredVerified.length > 0 && (
                  <Section
                    heading="Verified Connections"
                    caption="Met in person and verified via QR."
                  >
                    <div className="space-y-2">
                      {filteredVerified.map((r) => (
                        <ConnectionCard
                          key={r.id}
                          rel={r}
                          onOpen={() => navigate(`/veggie/${r.other.profileId}`)}
                        />
                      ))}
                    </div>
                  </Section>
                )}
                <Section
                  heading="Other Connections"
                  caption="Meet in person to verify."
                >
                  {filteredOthers.length === 0 ? (
                    <p className="text-sm text-charcoal-muted px-1">
                      No unverified connections right now.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filteredOthers.map((r) => (
                        <ConnectionCard
                          key={r.id}
                          rel={r}
                          onOpen={() => navigate(`/veggie/${r.other.profileId}`)}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </>
            )}
          </div>
        )}

        {tab === "requests" && (
          <div className="mt-5 space-y-6">
            {networkQuery.isLoading ? (
              <Card className="h-32 animate-pulse" />
            ) : (data?.incoming.length ?? 0) === 0 &&
              (data?.outgoing.length ?? 0) === 0 ? (
              <EmptyState
                icon={<Inbox className="w-6 h-6" />}
                title="No pending requests."
                description="When someone sends a request, it will appear here."
              />
            ) : (
              <>
                <Section heading="Received">
                  {(data?.incoming.length ?? 0) === 0 ? (
                    <p className="text-sm text-charcoal-muted px-1">
                      No incoming requests.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data!.incoming.map((r) => (
                        <RequestRow
                          key={r.id}
                          rel={r}
                          onAccept={() => handleAccept(r)}
                          onDecline={() => handleDecline(r)}
                          onOpen={() => navigate(`/veggie/${r.other.profileId}`)}
                        />
                      ))}
                    </div>
                  )}
                </Section>

                <Section heading="Sent">
                  {(data?.outgoing.length ?? 0) === 0 ? (
                    <p className="text-sm text-charcoal-muted px-1">
                      You haven't sent any requests.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data!.outgoing.map((r) => (
                        <SentRow
                          key={r.id}
                          rel={r}
                          onCancel={() => handleCancel(r)}
                          onOpen={() => navigate(`/veggie/${r.other.profileId}`)}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </>
            )}
          </div>
        )}

        {tab === "meet-next" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-charcoal-muted leading-relaxed px-1">
              A small, curated set of people you may want to meet. Every
              recommendation shows why it's here.
            </p>
            {meetNextQuery.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                <LoadingSkeleton className="h-24 w-full rounded-card" />
                <LoadingSkeleton className="h-24 w-full rounded-card" />
              </div>
            ) : meetNextQuery.isError ? (
              <EmptyState
                icon={<Handshake className="w-6 h-6" />}
                title="Recommendations are unavailable right now."
                description="Please try again in a moment."
                action={
                  <PrimaryButton onClick={() => meetNextQuery.refetch()}>
                    Try again
                  </PrimaryButton>
                }
              />
            ) : (meetNextQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={<Handshake className="w-6 h-6" />}
                title="Veggies are still joining"
                description="As more people join near you, we’ll suggest who to meet next."
                action={
                  <PrimaryButton onClick={() => navigate("/community")}>
                    Explore Community
                  </PrimaryButton>
                }
              />
            ) : (
              <div className="space-y-2">
                {meetNextQuery.data!.map((c) => (
                  <MeetNextCard
                    key={c.profileId}
                    candidate={c}
                    onView={() => navigate(`/veggie/${c.profileId}`)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Building blocks ---------- */

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        // WO-095B DEF-095A-05: `min-w-0` lets the label wrap instead of setting
        // a content-width floor that pushed the tab row past the viewport.
        "flex-1 min-w-0 px-2 py-2 rounded-full text-sm font-medium text-center transition-colors inline-flex flex-wrap items-center justify-center gap-1.5",
        active
          ? "bg-background text-charcoal shadow-sm"
          : "text-charcoal-muted",
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-primary/15 text-primary",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Section({
  heading,
  caption,
  children,
}: {
  heading: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="px-1 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
          {heading}
        </h3>
        {caption && (
          <p className="mt-0.5 text-[11px] text-charcoal-muted">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-charcoal-muted absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        aria-label="Search your Veggie Network"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name or city"
        className="w-full pl-9 pr-3 py-2.5 rounded-full bg-muted text-sm text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-card bg-soft-green/50 p-4">
      <div className="text-3xl font-bold text-charcoal leading-none tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
        {label}
      </div>
      <div className="mt-0.5 text-[11px] text-charcoal-muted">{hint}</div>
    </div>
  );
}

function InterestChip({ label, shared }: { label: string; shared?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize",
        shared
          ? "bg-soft-green text-primary"
          : "bg-soft-green/40 text-charcoal",
      )}
    >
      {label}
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-soft-green text-primary text-[10px] font-semibold">
      <Leaf className="w-3 h-3" />
      Verified Connection
    </span>
  );
}

function ConnectionCard({
  rel,
  onOpen,
}: {
  rel: Relationship;
  onOpen: () => void;
}) {
  const isVerified = rel.status === "verified";
  return (
    <Card interactive padding="md" onClick={onOpen}>
      <div className="flex gap-3">
        <UserAvatar
          name={rel.other.displayName}
          src={rel.other.avatarUrl ?? undefined}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-charcoal truncate">
              {firstName(rel.other.displayName)}
            </h3>
            {isVerified ? (
              <VerifiedBadge />
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-charcoal-muted">
                Connected
              </span>
            )}
          </div>
          {rel.other.city && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-muted">
              <MapPin className="w-3 h-3" />
              {rel.other.city}
            </div>
          )}
          {rel.other.interests.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rel.other.interests.slice(0, 3).map((i) => (
                <InterestChip key={i} label={i} />
              ))}
            </div>
          )}
          {!isVerified && (
            <p className="mt-2 text-[11px] text-charcoal-muted">
              Meet in person to verify your connection.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function RequestRow({
  rel,
  onAccept,
  onDecline,
  onOpen,
}: {
  rel: Relationship;
  onAccept: () => void;
  onDecline: () => void;
  onOpen: () => void;
}) {
  return (
    <Card padding="md">
      <div className="flex items-start gap-3">
        <button
          onClick={onOpen}
          className="shrink-0"
          aria-label={`Open ${rel.other.displayName}'s profile`}
        >
          <UserAvatar
            name={rel.other.displayName}
            src={rel.other.avatarUrl ?? undefined}
            size="md"
          />
        </button>
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <div className="font-semibold text-charcoal truncate">
            {firstName(rel.other.displayName)}
          </div>
          {rel.other.city && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-muted truncate">
              <MapPin className="w-3 h-3" /> {rel.other.city}
            </div>
          )}
          {rel.other.interests.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {rel.other.interests.slice(0, 3).map((i) => (
                <InterestChip key={i} label={i} />
              ))}
            </div>
          )}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 justify-end">
        <SecondaryButton size="sm" onClick={onDecline}>
          Decline
        </SecondaryButton>
        <PrimaryButton size="sm" onClick={onAccept}>
          Accept
        </PrimaryButton>
      </div>
    </Card>
  );
}

function SentRow({
  rel,
  onCancel,
  onOpen,
}: {
  rel: Relationship;
  onCancel: () => void;
  onOpen: () => void;
}) {
  return (
    <Card padding="md" className="flex items-center gap-3">
      <button onClick={onOpen} aria-label={`Open ${rel.other.displayName}'s profile`} className="shrink-0">
        <UserAvatar
          name={rel.other.displayName}
          src={rel.other.avatarUrl ?? undefined}
          size="md"
        />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="font-semibold text-charcoal truncate">
          {firstName(rel.other.displayName)}
        </div>
        {rel.other.city && (
          <div className="text-xs text-charcoal-muted truncate">
            {rel.other.city}
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-charcoal-muted">
          Request sent
        </div>
      </button>
      <SecondaryButton size="sm" onClick={onCancel}>
        Cancel
      </SecondaryButton>
    </Card>
  );
}

function MeetNextCard({
  candidate,
  onView,
}: {
  candidate: MeetNextCandidate;
  onView: () => void;
}) {
  const shared = new Set(
    candidate.sharedInterests.map((i) => i.toLowerCase()),
  );
  const interests = candidate.interests.slice(0, 3);
  return (
    <Card padding="md">
      <div className="flex gap-3">
        <UserAvatar
          name={candidate.displayName}
          src={candidate.avatarUrl ?? undefined}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-charcoal truncate">
            {candidate.firstName}
          </h3>
          {candidate.city && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-muted">
              <MapPin className="w-3 h-3" />
              {candidate.city}
            </div>
          )}
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sprout className="w-3.5 h-3.5" />
            {candidate.reason}
          </div>
          {interests.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {interests.map((i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] capitalize",
                    shared.has(i.toLowerCase())
                      ? "bg-soft-green/60 text-charcoal"
                      : "bg-muted text-charcoal-muted",
                  )}
                >
                  {i}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <SecondaryButton size="sm" onClick={onView}>
          <UserPlus className="w-4 h-4" />
          View Profile
        </SecondaryButton>
      </div>
    </Card>
  );
}
