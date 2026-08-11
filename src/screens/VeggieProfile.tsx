import { safeBack } from "@/lib/navigation";
import { logAnalyticsEvent } from "@/lib/analytics";
import { BackButton } from "@/components/app";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProfileSafetyMenu } from "@/components/safety/ProfileSafetyMenu";
import {
  CalendarPlus,
  Calendar,
  Check,
  Handshake,
  Home,
  Leaf,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";

import {
  AppHeader,
  Card,
  CommunityPlaceCard,
  EmptyState,
  MeetupCard,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchRelationshipWith,
  sendConnectionRequest,
} from "@/lib/relationships";
import {
  DIETARY_LABEL,
  fetchVeggieProfileBundle,
  type Dietary,
} from "@/lib/veggieProfile";
import { fetchPublicCommunityImpact } from "@/lib/communityImpact";
import { MeetupInvitationSheet } from "@/components/invitations/MeetupInvitationSheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function VeggieProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const qc = useQueryClient();
  const isSelf = !!me && me.id === id;

  const bundleQuery = useQuery({
    queryKey: ["veggie-profile", id, me?.id ?? "anon"],
    enabled: !!id,
    queryFn: () => fetchVeggieProfileBundle(id!, me?.id),
  });

  const publicImpactQuery = useQuery({
    queryKey: ["veggie-public-impact", id],
    enabled: !!id,
    queryFn: () => fetchPublicCommunityImpact(id!),
    staleTime: 30_000,
  });

  const relQuery = useQuery({
    queryKey: ["relationship-with", me?.id, id],
    enabled: !!me?.id && !!id && !isSelf,
    queryFn: () => fetchRelationshipWith(me!.id, id!),
  });

  const [busy, setBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const bundle = bundleQuery.data;
  const rel = relQuery.data;
  const relStatus = rel?.status;
  const isRequester = rel?.requesterId === me?.id;
  const isConnected = relStatus === "connected" || relStatus === "verified";
  const isPending = relStatus === "pending";
  const showFooter = isSelf || (!isSelf && !!me);


  // WO-072: public profile surfaces may only show real, member-owned imagery.
  // No stock/filler images — an empty gallery renders nothing.
  const photos = useMemo(() => {
    if (!bundle) return [] as string[];
    const arr: string[] = [];
    if (bundle.profile.avatarUrl) arr.push(bundle.profile.avatarUrl);
    for (const m of bundle.upcoming) {
      if (arr.length >= 3) break;
      if (m.coverImageUrl && !arr.includes(m.coverImageUrl)) arr.push(m.coverImageUrl);
    }
    return arr.slice(0, 3);
  }, [bundle]);


  async function handleConnect() {
    if (!me || !id) return;
    setBusy(true);
    try {
      const res = await sendConnectionRequest(me.id, id);
      // WO-096 DEF-096-01: sending a Connection Request is a level-2
      // activation outcome and had no telemetry.
      logAnalyticsEvent("connection_request_sent", { outcome: res.state });
      if (res.state === "connected") toast.success("You're now connected");
      else toast.success("Connection request sent");
      relQuery.refetch();
    } catch {
      toast.error("Couldn't send request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Profile"
        left={
          <BackButton fallback="/community" />
        }
        right={
          bundle && !isSelf && me ? (
            <ProfileSafetyMenu
              profileId={bundle.profile.id}
              displayName={bundle.profile.firstName || bundle.profile.displayName}
              onBlocked={() => {
                qc.invalidateQueries({ queryKey: ["veggie-profile"] });
                qc.invalidateQueries({ queryKey: ["relationship-with"] });
                qc.invalidateQueries({ queryKey: ["blocked-profiles"] });
                safeBack(navigate, "/community");
              }}
            />
          ) : undefined
        }
      />

      {bundleQuery.isLoading ? (
        <div className="px-5 pt-2 space-y-4">
          <Card className="h-64 animate-pulse" />
          <Card className="h-32 animate-pulse" />
        </div>
      ) : !bundle ? (
        <EmptyState
          title="This profile isn't available."
          description="You can't view this Veggie right now."
        />
      ) : (
        <div className={cn(showFooter ? "pb-32" : "pb-6")}>
          {/* Header */}
          <section className="px-5 pt-4 flex flex-col items-center text-center">
            <UserAvatar
              name={bundle.profile.displayName}
              src={bundle.profile.avatarUrl ?? undefined}
              size="xl"
            />
            <h2 className="mt-3 text-2xl font-semibold text-charcoal">
              {bundle.profile.firstName}
              {bundle.profile.age ? (
                <span className="ml-1 font-normal text-charcoal-muted">
                  , {bundle.profile.age}
                </span>
              ) : null}
            </h2>
            {bundle.profile.city && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-charcoal-muted">
                <MapPin className="w-3.5 h-3.5" />
                {bundle.profile.city}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 flex-wrap justify-center">
              <DietaryBadge dietary={bundle.profile.dietary} />
              {bundle.profile.isActiveHost && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted text-charcoal">
                  <Sparkles className="w-3 h-3" />
                  Active Host
                </span>
              )}
            </div>
          </section>



          {/* Mutual connections */}
          {bundle.mutualConnections.length > 0 && (
            <section className="px-5 mt-6">
              <Card padding="md" className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {bundle.mutualConnections.slice(0, 4).map((m) => (
                    <UserAvatar
                      key={m.profileId}
                      name={m.displayName}
                      src={m.avatarUrl ?? undefined}
                      size="sm"
                      ring
                    />
                  ))}
                </div>
                <div className="text-xs text-charcoal-muted">
                  {bundle.mutualConnections.length} mutual{" "}
                  {bundle.mutualConnections.length === 1 ? "connection" : "connections"}
                </div>
              </Card>
            </section>
          )}

          {/* About Me */}
          {bundle.profile.bio && (
            <Section title="About Me">
              <p className="text-sm text-charcoal leading-relaxed">
                {bundle.profile.bio}
              </p>
            </Section>
          )}

          {/* Photos — only rendered when the member actually has imagery */}
          {(photos.length > 0 || isSelf) && (
            <Section title="Photos">
              {photos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPhotoOpen(photos[0])}
                    className={cn(
                      "relative rounded-card overflow-hidden bg-muted",
                      photos.length === 1
                        ? "col-span-2 aspect-[16/10]"
                        : "col-span-2 aspect-[16/10]",
                    )}
                  >
                    <img
                      src={photos[0]}
                      alt={`${bundle.profile.firstName} photo`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                  {photos.slice(1, 3).map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPhotoOpen(src)}
                      className="relative rounded-card overflow-hidden aspect-square bg-muted"
                    >
                      <img
                        src={src}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-charcoal-muted">
                  No photos yet. Add a profile photo so Veggies can recognise you.
                </p>
              )}
              {isSelf && (
                <button
                  type="button"
                  onClick={() => navigate("/you/edit")}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-charcoal-muted hover:text-charcoal"
                >
                  <Pencil className="w-3 h-3" />
                  Edit photos
                </button>
              )}
            </Section>
          )}


          {/* Interests / Shared Interests */}
          {(() => {
            const viewingOther = !!me && !isSelf;
            const mine = new Set((me?.interests ?? []).map((i) => i.toLowerCase()));
            const shownInterests = viewingOther
              ? bundle.profile.interests.filter((i) => mine.has(i.toLowerCase()))
              : bundle.profile.interests;
            if (shownInterests.length === 0) return null;
            return (
              <Section title={viewingOther ? "Shared Interests" : "Interests"}>
                <SharedInterests interests={shownInterests} highlight={viewingOther} />
              </Section>
            );
          })()}

          {/* Upcoming Meetups */}
          {bundle.upcoming.length > 0 && (
            <Section title="Upcoming Meetups">
              <div className="space-y-3">
                {bundle.upcoming.map((m) => (
                  <MeetupCard key={m.id} meetup={m} />
                ))}
              </div>
            </Section>
          )}

          {/* Favorite Community Places */}
          {bundle.favoritePlaces.length > 0 && (
            <Section title="Favorite Community Places" pad={false}>
              <div className="rail flex gap-3 overflow-x-auto px-5 pb-1 snap-x snap-mandatory scrollbar-hide">
                {bundle.favoritePlaces.map((p) => (
                  <div key={p.id} className="snap-start">
                    <CommunityPlaceCard place={p} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Community Impact (canonical) */}
          <Section title="Community Impact">
            <div className="grid grid-cols-3 gap-3">
              <ActivityStat
                icon={<Handshake className="w-4 h-4" />}
                label="Veggies Met"
                value={publicImpactQuery.data?.veggies_met ?? bundle.metrics.verifiedConnections}
              />
              <ActivityStat
                icon={<Home className="w-4 h-4" />}
                label="Places Supported"
                value={publicImpactQuery.data?.community_places_supported ?? bundle.metrics.placesSupported}
              />
              <ActivityStat
                icon={<Sparkles className="w-4 h-4" />}
                label="Meetups Hosted"
                value={publicImpactQuery.data?.meetups_hosted ?? bundle.metrics.hosted}
              />
            </div>
          </Section>

          {/* Verification */}
          <Section title="Verification">
            <Card padding="md" className="space-y-2.5">
              <VerifyRow
                icon={<ShieldCheck className="w-4 h-4" />}
                label="Identity"
                value="Verified email"
              />
              <VerifyRow
                icon={<Leaf className="w-4 h-4" />}
                label="Veggies Met"
                value={`${publicImpactQuery.data?.veggies_met ?? bundle.metrics.verifiedConnections}`}
              />
              {bundle.profile.city && (
                <VerifyRow
                  icon={<MapPin className="w-4 h-4" />}
                  label="City"
                  value={bundle.profile.city}
                />
              )}
            </Card>
          </Section>
        </div>
      )}

      {/* Bottom action bar (non-self) */}
      {bundle && !isSelf && me && !isConnected && (
        <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="w-full max-w-phone pointer-events-auto bg-background/95 backdrop-blur border-t border-border/60 px-5 pt-3 pb-6 safe-bottom">
            {isPending ? (
              <SecondaryButton fullWidth disabled>
                <Check className="w-4 h-4" />
                {isRequester ? "Request sent" : "They asked to connect"}
              </SecondaryButton>
            ) : (
              <PrimaryButton fullWidth disabled={busy} onClick={handleConnect}>
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                Connect with {bundle.profile.firstName}
              </PrimaryButton>
            )}
          </div>
        </div>
      )}

      {/* Bottom action bar (connected) */}
      {bundle && !isSelf && me && isConnected && (
        <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="w-full max-w-phone pointer-events-auto bg-background/95 backdrop-blur border-t border-border/60 px-5 pt-3 pb-6 safe-bottom">
            <div className="flex gap-2">
              <PrimaryButton
                fullWidth
                onClick={() => navigate(`/dm/user/${bundle.profile.id}`)}
              >
                <MessageCircle className="w-4 h-4" />
                Message
              </PrimaryButton>
              <SecondaryButton
                fullWidth
                onClick={() => setInviteOpen(true)}
              >
                <CalendarPlus className="w-4 h-4" />
                Invite
              </SecondaryButton>
            </div>
          </div>
        </div>
      )}


      {/* Bottom action bar (self) */}
      {bundle && isSelf && (
        <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="w-full max-w-phone pointer-events-auto bg-background/95 backdrop-blur border-t border-border/60 px-5 pt-3 pb-6 safe-bottom">
            <SecondaryButton fullWidth onClick={() => navigate("/you/edit")}>
              <Pencil className="w-4 h-4" />
              Edit Profile
            </SecondaryButton>
          </div>
        </div>
      )}

      <Dialog open={!!photoOpen} onOpenChange={(o) => !o && setPhotoOpen(null)}>
        <DialogContent className="p-0 border-0 bg-transparent max-w-lg shadow-none">
          {photoOpen && (
            <img
              src={photoOpen}
              alt=""
              className="w-full h-auto rounded-card object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {bundle && me && (
        <MeetupInvitationSheet
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          senderProfileId={me.id}
          recipient={{
            profileId: bundle.profile.id,
            firstName: bundle.profile.firstName,
            displayName: bundle.profile.displayName,
          }}
          onSent={() => {
            toast.success(`Invitation sent to ${bundle.profile.firstName}.`);
            navigate(`/dm/user/${bundle.profile.id}`);
          }}
        />
      )}
    </>
  );
}

function Section({
  title,
  children,
  pad = true,
}: {
  title: string;
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <section className="mt-8">
      <h3 className="px-5 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-3">
        {title}
      </h3>
      <div className={pad ? "px-5" : ""}>{children}</div>
    </section>
  );
}

function DietaryBadge({ dietary }: { dietary: Dietary }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-soft-green text-primary">
      <Leaf className="w-3 h-3" />
      {DIETARY_LABEL[dietary]}
    </span>
  );
}

function SharedInterests({
  interests,
  highlight,
}: {
  interests: string[];
  highlight: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {interests.map((i) => (
        <span
          key={i}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium capitalize border",
            highlight
              ? "bg-soft-green text-primary border-primary/20"
              : "bg-muted text-charcoal border-transparent",
          )}
        >
          {highlight && <Check className="inline w-3 h-3 mr-1 -mt-0.5" />}
          {i}
        </span>
      ))}
    </div>
  );
}


function ActivityStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-card bg-soft-green/60 p-4">
      <div className="text-2xl font-bold text-charcoal tabular-nums leading-none">
        {value}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary leading-tight">
        {icon}
        {label}
      </div>
    </div>
  );
}

function VerifyRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-control bg-soft-green/60 text-primary flex items-center justify-center">
        {icon}
      </div>
      <div className="flex-1 text-sm text-charcoal">{label}</div>
      <div className="text-xs text-charcoal-muted">{value}</div>
    </div>
  );
}
