import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Leaf, Loader2, MapPin, MessageCircle, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PrimaryButton, SecondaryButton, TertiaryButton, UserAvatar } from "@/components/app";
import { ProfileSafetyMenu } from "@/components/safety/ProfileSafetyMenu";
import { useAuth } from "@/hooks/useAuth";
import { DIETARY_LABEL, fetchVeggieProfileBundle } from "@/lib/veggieProfile";
import { acceptRequest, fetchRelationshipWith, sendConnectionRequest } from "@/lib/relationships";
import { logAnalyticsEvent } from "@/lib/analytics";
import { memberSafeMessage } from "@/lib/errors";

/**
 * Quick profile popup, opened by tapping a member's avatar or name in a chat.
 * Shows the essentials and the same actions as the full profile (connect,
 * accept, message, report, block) without leaving the conversation. All
 * availability and block rules come from the same server projections the
 * full profile uses, so nothing is shown here that the profile page hides.
 */
export function ProfilePeekSheet({ profileId, onClose }: { profileId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const open = !!profileId && !!me && profileId !== me.id;

  const bundleQ = useQuery({
    queryKey: ["veggie-profile", profileId, me?.id ?? "anon"],
    enabled: open,
    queryFn: () => fetchVeggieProfileBundle(profileId!, me?.id),
  });
  const relQ = useQuery({
    queryKey: ["relationship-with", me?.id, profileId],
    enabled: open,
    queryFn: () => fetchRelationshipWith(me!.id, profileId!),
  });

  const bundle = bundleQ.data;
  const rel = relQ.data;
  const status = rel?.status;
  const isConnected = status === "connected" || status === "verified";
  const isPending = status === "pending";
  const theyAsked = isPending && rel?.requesterId !== me?.id;

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const connect = async () => {
    if (!me || !profileId) return;
    setBusy(true);
    try {
      const res = await sendConnectionRequest(me.id, profileId);
      logAnalyticsEvent("connection_request_sent", { outcome: res.state });
      toast.success(res.state === "connected" ? "You're now connected" : "Connection request sent");
      relQ.refetch();
      qc.invalidateQueries({ queryKey: ["network"] });
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!rel?.id) return;
    setBusy(true);
    try {
      await acceptRequest(rel.id);
      toast.success("You're now connected");
      relQ.refetch();
      qc.invalidateQueries({ queryKey: ["network"] });
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl border-t border-border p-0 max-h-[85dvh] flex flex-col" data-testid="profile-peek">
        {bundleQ.isPending ? (
          <div className="page-x py-8 flex flex-col items-center gap-3">
            <SheetTitle className="sr-only">Loading profile</SheetTitle>
            <SheetDescription className="sr-only">Please wait</SheetDescription>
            <Loader2 className="w-5 h-5 animate-spin text-charcoal-muted" aria-hidden />
          </div>
        ) : !bundle ? (
          <div className="page-x py-8 text-center">
            <SheetTitle className="text-base font-semibold text-charcoal">This profile isn't available.</SheetTitle>
            <SheetDescription className="text-sm text-charcoal-muted mt-1">The member may have left or the profile can't be shown.</SheetDescription>
          </div>
        ) : (
          <>
            <SheetHeader className="page-x pt-5 pb-2 text-left">
              <div className="flex items-start gap-3">
                <UserAvatar name={bundle.profile.displayName} src={bundle.profile.avatarUrl ?? undefined} size="lg" />
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-lg font-semibold text-charcoal [overflow-wrap:anywhere]">
                    {bundle.profile.displayName}
                  </SheetTitle>
                  <SheetDescription className="text-sm text-charcoal-muted">
                    {bundle.profile.city ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" aria-hidden /> {bundle.profile.city}
                      </span>
                    ) : (
                      "VeggieMeet member"
                    )}
                  </SheetDescription>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-soft-green text-primary">
                      <Leaf className="w-3 h-3" aria-hidden /> {DIETARY_LABEL[bundle.profile.dietary]}
                    </span>
                    {bundle.profile.isActiveHost && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-charcoal-muted">
                        <Sparkles className="w-3 h-3" aria-hidden /> Active Host
                      </span>
                    )}
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary">
                        <Check className="w-3 h-3" aria-hidden /> {status === "verified" ? "Verified connection" : "Connected"}
                      </span>
                    )}
                  </div>
                </div>
                <ProfileSafetyMenu
                  profileId={bundle.profile.id}
                  displayName={bundle.profile.displayName}
                  onBlocked={() => {
                    qc.invalidateQueries({ queryKey: ["veggie-profile", profileId] });
                    onClose();
                  }}
                />
              </div>
            </SheetHeader>

            <div className="page-x pb-6 overflow-y-auto space-y-4">
              {bundle.profile.bio && (
                <p className="text-sm text-charcoal leading-relaxed line-clamp-4 [overflow-wrap:anywhere]">{bundle.profile.bio}</p>
              )}

              {bundle.profile.interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {bundle.profile.interests.slice(0, 8).map((i) => {
                    const shared = (me?.interests ?? []).some((x) => x.toLowerCase() === i.toLowerCase());
                    return (
                      <span
                        key={i}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${shared ? "bg-soft-green text-primary" : "bg-muted text-charcoal-muted"}`}
                      >
                        {i}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Hosted" value={bundle.metrics.hosted} />
                <Stat label="Joined" value={bundle.metrics.joined} />
                <Stat label="Veggies met" value={bundle.metrics.verifiedConnections} />
              </div>

              {bundle.mutualConnections.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-charcoal-muted">
                  <div className="flex -space-x-2">
                    {bundle.mutualConnections.slice(0, 3).map((m) => (
                      <UserAvatar key={m.profileId} name={m.displayName} src={m.avatarUrl ?? undefined} size="xs" ring />
                    ))}
                  </div>
                  {bundle.mutualConnections.length} mutual {bundle.mutualConnections.length === 1 ? "connection" : "connections"}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                {isConnected ? (
                  <PrimaryButton fullWidth onClick={() => go(`/dm/user/${bundle.profile.id}`)}>
                    <MessageCircle className="w-4 h-4" /> Message
                  </PrimaryButton>
                ) : theyAsked ? (
                  <PrimaryButton fullWidth disabled={busy} onClick={accept}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Accept connection request
                  </PrimaryButton>
                ) : isPending ? (
                  <SecondaryButton fullWidth disabled>
                    <Check className="w-4 h-4" /> Request sent
                  </SecondaryButton>
                ) : (
                  <PrimaryButton fullWidth disabled={busy || relQ.isPending} onClick={connect}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Connect with {bundle.profile.firstName}
                  </PrimaryButton>
                )}
                <TertiaryButton fullWidth onClick={() => go(`/veggie/${bundle.profile.id}`)}>
                  View full profile
                </TertiaryButton>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-soft-green/60 py-2">
      <div className="text-lg font-bold text-charcoal tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-semibold text-primary">{label}</div>
    </div>
  );
}

export default ProfilePeekSheet;
