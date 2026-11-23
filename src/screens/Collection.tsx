import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sticker } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader, BackButton, Card, EmptyState, SecondaryButton, UserAvatar } from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import { useMyCollection, usePublicCollection } from "@/hooks/useCollection";
import { LevelRing } from "@/components/collection/LevelRing";
import { CollectionPanel } from "@/components/collection/CollectionPanel";
import { profileLevel } from "@/lib/collection";
import { memberSafeMessage } from "@/lib/errors";

/**
 * Collection — stickers, memory cards, level and badges for one member.
 * `/you/collection` is the signed-in member's full-page view (the same panel
 * also lives inline on My Profile); `/veggie/:id/collection` is another
 * member's public view (hidden cards and suggestions are server-side omitted,
 * blocks make it unavailable).
 */
export default function Collection() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const isSelf = !id || id === me?.id;

  const mineQ = useMyCollection(isSelf);
  const publicQ = usePublicCollection(isSelf ? undefined : id);
  const q = isSelf ? mineQ : publicQ;

  const ownerQ = useQuery({
    queryKey: ["collection-owner", id],
    enabled: !isSelf && !!id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, display_name, avatar_url").eq("id", id!).maybeSingle();
      return data as { id: string; display_name: string; avatar_url: string | null } | null;
    },
  });

  const data = q.data;
  const level = useMemo(() => (data ? profileLevel(data.stickers, data.stats) : null), [data]);
  const ownerName = isSelf ? me?.display_name ?? "You" : ownerQ.data?.display_name ?? "Veggie";
  const firstName = ownerName.split(/\s+/)[0] || ownerName;

  return (
    <div className="pb-16 animate-fade-in">
      <AppHeader
        left={<BackButton fallback={isSelf ? "/you" : id ? `/veggie/${id}` : "/you"} />}
        title={isSelf ? "My Collection" : `${firstName}'s Collection`}
        subtitle={isSelf ? "Stickers, cards and badges from your veggie life" : undefined}
      />

      <div className="px-5 mt-2 space-y-5">
        {q.isPending ? (
          <>
            <Card className="h-24 animate-pulse" />
            <Card className="h-40 animate-pulse" />
          </>
        ) : q.isError ? (
          <EmptyState
            icon={<Sticker className="w-5 h-5" />}
            title="We couldn't load this collection."
            description={memberSafeMessage(q.error)}
            action={<SecondaryButton size="sm" onClick={() => q.refetch()}>Try again</SecondaryButton>}
          />
        ) : !data || !data.available ? (
          <EmptyState
            icon={<Sticker className="w-5 h-5" />}
            title="This collection isn't available."
            action={<SecondaryButton size="sm" onClick={() => navigate(-1)}>Go back</SecondaryButton>}
          />
        ) : (
          <>
            {level && (
              <Card padding="lg" className="flex items-center gap-4">
                {isSelf ? (
                  <LevelRing level={level} size={72} />
                ) : (
                  <div className="relative">
                    <UserAvatar name={ownerName} src={ownerQ.data?.avatar_url ?? undefined} size="lg" />
                    <span className="absolute -bottom-1 -right-1 min-w-6 h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center ring-2 ring-card">
                      {level.level}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-charcoal-muted">Level {level.level}</div>
                  <div className="text-lg font-semibold text-charcoal leading-tight">{level.name}</div>
                  <div className="mt-1 text-xs text-charcoal-muted">
                    {level.nextMin
                      ? `${level.points} pts · ${level.nextMin - level.points} to level ${level.level + 1}`
                      : `${level.points} pts · top level`}
                  </div>
                  {!isSelf && (
                    <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(level.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
              </Card>
            )}

            <CollectionPanel data={data} isSelf={isSelf} firstName={firstName} />
          </>
        )}
      </div>
    </div>
  );
}
