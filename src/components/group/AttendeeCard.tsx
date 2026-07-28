import { useEffect, useState } from "react";
import { Leaf, MapPin, UserPlus, Check, Loader2 } from "lucide-react";
import { Card, UserAvatar, ActiveHostBadge, HostBadge } from "@/components/app";
import type { Veggie } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchRelationshipWith,
  sendConnectionRequest,
  type Relationship,
} from "@/lib/relationships";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AttendeeCardProps {
  veggie: Veggie;
  isHost?: boolean;
  showConnect?: boolean;
}

const interestEmoji: Record<string, string> = {
  vegan: "🌱",
  coffee: "☕",
  running: "🏃",
  hiking: "🥾",
  foodie: "🍜",
  books: "📚",
  reading: "📚",
  yoga: "🧘",
  cooking: "🍳",
  baking: "🥐",
  cycling: "🚴",
  games: "🎲",
  wine: "🍷",
  markets: "🛍️",
  brunch: "🥑",
  ramen: "🍜",
  art: "🎨",
};

function InterestChip({ label }: { label: string }) {
  const emoji = interestEmoji[label.toLowerCase()] ?? "🌿";
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-soft-green/30 text-charcoal text-[11px] font-medium">
      <span aria-hidden>{emoji}</span>
      <span className="capitalize">{label}</span>
    </span>
  );
}

function ConnectButton({ otherProfileId }: { otherProfileId: string }) {
  const { profile } = useAuth();
  const [rel, setRel] = useState<Relationship | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.id || profile.id === otherProfileId) {
      setLoading(false);
      return;
    }
    fetchRelationshipWith(profile.id, otherProfileId)
      .then((r) => {
        if (!cancelled) setRel(r);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [profile?.id, otherProfileId]);

  if (!profile || profile.id === otherProfileId) return null;
  if (loading) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-charcoal-muted"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </button>
    );
  }

  const status = rel?.status;
  const isPending =
    status === "pending" && rel?.requesterId === profile.id;
  const isTheirRequest =
    status === "pending" && rel?.requesterId && rel?.requesterId !== profile.id;
  const isActive = status === "connected" || status === "verified";

  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
        <Check className="w-3.5 h-3.5" />
        {status === "verified" ? (
          <>
            Verified Connection <Leaf className="w-3 h-3" />
          </>
        ) : (
          "Connected"
        )}
      </span>
    );
  }
  if (isPending) {
    return (
      <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-charcoal-muted">
        Requested
      </span>
    );
  }

  async function handleClick() {
    if (!profile) return;
    setBusy(true);
    try {
      const res = await sendConnectionRequest(profile.id, otherProfileId);
      if (res.state === "connected") {
        toast.success("You're now connected");
        setRel({
          id: rel?.id ?? "",
          status: "connected",
          requesterId: null,
          other: {
            profileId: otherProfileId,
            displayName: "",
            avatarUrl: null,
            bio: null,
            city: null,
            cityId: null,
            interests: [],
          },
        });
      } else {
        toast.success(
          isTheirRequest ? "Request accepted" : "Connection request sent",
        );
        setRel({
          id: rel?.id ?? "",
          status: "pending",
          requesterId: profile.id,
          other: {
            profileId: otherProfileId,
            displayName: "",
            avatarUrl: null,
            bio: null,
            city: null,
            cityId: null,
            interests: [],
          },
        });
      }
    } catch {
      toast.error("Couldn't send request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground",
        "disabled:opacity-60",
      )}
    >
      <UserPlus className="w-3.5 h-3.5" />
      Connect
    </button>
  );
}

export function AttendeeCard({ veggie, isHost, showConnect }: AttendeeCardProps) {
  const chips = veggie.interests.slice(0, 4);
  return (
    <Card padding="md" className="flex gap-4">
      <UserAvatar name={veggie.displayName} src={veggie.avatarUrl} size="lg" />
      <div className="min-w-0 flex-1">
        {isHost && (
          <div className="text-[10px] font-semibold uppercase tracking-wider text-charcoal-muted mb-0.5">
            Organizer
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-charcoal leading-tight">
                {veggie.displayName}
              </h3>
              {isHost ? (
                <ActiveHostBadge />
              ) : veggie.isActiveHost ? (
                <HostBadge>Host</HostBadge>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-muted">
              <MapPin className="w-3 h-3" />
              <span>{veggie.currentCity}</span>
            </div>
          </div>
          {showConnect && <ConnectButton otherProfileId={veggie.id} />}
        </div>
        <p className="mt-2 text-sm text-charcoal leading-snug line-clamp-2">
          {veggie.bio}
        </p>
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <InterestChip key={c} label={c} />
            ))}
          </div>
        )}
        <div className="mt-3 text-[11px] text-charcoal-muted">
          {isHost ? (
            <>
              Hosted {veggie.meetupsHostedCount} meetups • Helped{" "}
              {veggie.veggiesMetCount} Veggies connect
            </>
          ) : (
            <>
              {veggie.meetupsAttendedCount} meetups attended
              {veggie.meetupsHostedCount > 0 &&
                ` • ${veggie.meetupsHostedCount} hosted`}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
