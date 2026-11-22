import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, Camera, Sparkles, Sticker } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader, BackButton, Card, EmptyState, SecondaryButton, UserAvatar } from "@/components/app";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useMemoryCard, useMyCollection, usePublicCollection } from "@/hooks/useCollection";
import { PlaceSticker } from "@/components/collection/PlaceSticker";
import { LevelRing } from "@/components/collection/LevelRing";
import { MemoryCardFrame } from "@/components/collection/MemoryCardTile";
import { BadgeTile } from "@/components/collection/BadgeTile";
import { BadgeDetailSheet } from "@/components/collection/BadgeDetailSheet";
import {
  evaluateBadges,
  type BadgeProgress,
  groupStickersByCity,
  nextStickerThreshold,
  profileLevel,
  STICKER_LEVEL_LABEL,
  type Collection as CollectionData,
  type PlaceSticker as PlaceStickerData,
} from "@/lib/collection";
import { memberSafeMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Tab = "stickers" | "cards" | "badges";

/**
 * Collection — stickers, memory cards, level and badges for one member.
 * `/you/collection` is the signed-in member; `/veggie/:id/collection` is
 * another member's public view (hidden cards and suggestions are server-side
 * omitted, blocks make it unavailable).
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

  const [tab, setTab] = useState<Tab>("stickers");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openBadge, setOpenBadge] = useState<BadgeProgress | null>(null);

  const data = q.data;
  const level = useMemo(() => (data ? profileLevel(data.stickers, data.stats) : null), [data]);
  const badges = useMemo(() => (data ? evaluateBadges(data.stickers, data.stats) : []), [data]);
  const earnedCount = badges.filter((b) => b.earned).length;

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
            {/* Level header */}
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

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Stickers" value={data.stickers.length} icon={<Sticker className="w-3.5 h-3.5" />} />
              <Stat label="Cards" value={data.cards.length} icon={<Camera className="w-3.5 h-3.5" />} />
              <Stat label="Badges" value={earnedCount} icon={<Award className="w-3.5 h-3.5" />} />
            </div>

            {/* Tabs */}
            <div className="flex bg-muted rounded-full p-1" role="tablist">
              <TabButton active={tab === "stickers"} onClick={() => setTab("stickers")}>Stickers</TabButton>
              <TabButton active={tab === "cards"} onClick={() => setTab("cards")}>Cards</TabButton>
              <TabButton active={tab === "badges"} onClick={() => setTab("badges")}>Badges</TabButton>
            </div>

            {tab === "stickers" && (
              <StickersTab data={data} isSelf={isSelf} firstName={firstName} onPlace={(pid) => navigate(`/place/${pid}`)} />
            )}
            {tab === "cards" && (
              <CardsTab data={data} isSelf={isSelf} firstName={firstName} onOpen={setOpenCard} />
            )}
            {tab === "badges" && (
              <div className="space-y-2">
                <p className="px-1 text-xs text-charcoal-muted">Tap a badge to see what counts toward it.</p>
                {badges.map((b) => (
                  <BadgeTile key={b.key} badge={b} onClick={() => setOpenBadge(b)} />
                ))}
              </div>
            )}

            {isSelf && level && (
              <Card padding="md" className="text-xs text-charcoal-muted space-y-1">
                <div className="flex items-center gap-1.5 text-charcoal font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-primary" /> How points work
                </div>
                <p>
                  10 per place you support, 3 per return visit, 15 per meetup you attend, 25 per meetup you host
                  that people show up to, and 10 per verified connection. Visits count when you check in at the place
                  or attend a meetup held there.
                </p>
              </Card>
            )}
          </>
        )}
      </div>

      <MemoryCardDialog cardId={openCard} onClose={() => setOpenCard(null)} />
      {data && data.available && (
        <BadgeDetailSheet
          badge={openBadge}
          data={data}
          isSelf={isSelf}
          onClose={() => setOpenBadge(null)}
          onShowCards={() => setTab("cards")}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StickersTab({
  data,
  isSelf,
  firstName,
  onPlace,
}: {
  data: CollectionData;
  isSelf: boolean;
  firstName: string;
  onPlace: (placeId: string) => void;
}) {
  const groups = useMemo(() => groupStickersByCity(data.stickers), [data.stickers]);

  return (
    <div className="space-y-6">
      {data.stickers.length === 0 ? (
        <EmptyState
          icon={<Sticker className="w-5 h-5" />}
          title={isSelf ? "No stickers yet" : `${firstName} hasn't collected stickers yet`}
          description={
            isSelf
              ? "Check in at a veggie place, or attend a meetup held there, to peel your first sticker."
              : undefined
          }
        />
      ) : (
        groups.map((g) => (
          <section key={g.city} aria-label={`${g.city} stickers`}>
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
              {g.city} · {g.stickers.length}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {g.stickers.map((s) => (
                <StickerTile key={s.place_id} sticker={s} onClick={() => onPlace(s.place_id)} />
              ))}
            </div>
          </section>
        ))
      )}

      {isSelf && data.uncollected.length > 0 && (
        <section aria-label="Places to collect">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-1">
            Not collected yet
          </h3>
          <p className="px-1 text-xs text-charcoal-muted mb-2">
            Verified places in your city you haven't visited. Tap one to plan your next bite.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {data.uncollected.map((p) => (
              <button
                key={p.place_id}
                type="button"
                onClick={() => onPlace(p.place_id)}
                className="flex flex-col items-center gap-1 rounded-card p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <PlaceSticker placeId={p.place_id} name={p.name} category={p.category} level={0} muted size={84} />
                <span className="text-[11px] text-charcoal-muted text-center leading-tight line-clamp-2">{p.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StickerTile({ sticker, onClick }: { sticker: PlaceStickerData; onClick: () => void }) {
  const next = nextStickerThreshold(sticker.visits);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-card p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={`${sticker.name}, ${STICKER_LEVEL_LABEL[sticker.level]}, ${sticker.visits} visits`}
    >
      <PlaceSticker placeId={sticker.place_id} name={sticker.name} category={sticker.category} level={sticker.level} size={84} />
      <span className="text-[11px] font-medium text-charcoal text-center leading-tight line-clamp-2">{sticker.name}</span>
      <span className="text-[10px] text-charcoal-muted tabular-nums">
        {sticker.visits} {sticker.visits === 1 ? "visit" : "visits"}
        {next ? ` · ${next - sticker.visits} to lvl ${sticker.level + 1}` : " · max"}
      </span>
    </button>
  );
}

function CardsTab({
  data,
  isSelf,
  firstName,
  onOpen,
}: {
  data: CollectionData;
  isSelf: boolean;
  firstName: string;
  onOpen: (cardId: string) => void;
}) {
  if (data.cards.length === 0) {
    return (
      <EmptyState
        icon={<Camera className="w-5 h-5" />}
        title={isSelf ? "No memory cards yet" : `${firstName} hasn't added memory cards yet`}
        description={
          isSelf
            ? "After a meetup ends, open its summary from My Plans and add a photo to turn it into a card."
            : undefined
        }
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {data.cards.map((c) => (
        <MemoryCardFrame
          key={c.id}
          src={c.thumb_data_url}
          title={c.title}
          date={c.date}
          placeLabel={c.place_name ?? c.city_name}
          caption={c.caption}
          hidden={isSelf && !c.is_public}
          onClick={() => onOpen(c.id)}
        />
      ))}
    </div>
  );
}

function MemoryCardDialog({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  const q = useMemoryCard(cardId);
  const navigate = useNavigate();
  const c = q.data;
  return (
    <Dialog open={!!cardId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-dialog border-0 sm:max-w-sm p-4 max-h-[90dvh] overflow-y-auto">
        <DialogTitle className="sr-only">Memory card</DialogTitle>
        <DialogDescription className="sr-only">Full-size memory card photo</DialogDescription>
        {q.isPending ? (
          <div className="aspect-[4/5] rounded-card bg-muted animate-pulse" />
        ) : !c || !c.available ? (
          <p className="text-sm text-charcoal-muted text-center py-6">This card isn't available.</p>
        ) : (
          <div className="space-y-3">
            <MemoryCardFrame
              src={c.photo_data_url!}
              title={c.title ?? ""}
              date={c.date ?? ""}
              placeLabel={c.place_name ?? c.city_name ?? null}
              caption={c.caption}
            />
            <div className="flex items-center justify-between text-xs text-charcoal-muted">
              <span>by {c.owner_name}</span>
              {c.meetup_id && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(`/meetup/${c.meetup_id}`);
                  }}
                  className="font-semibold text-primary"
                >
                  View meetup
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card variant="metric" padding="sm" className="text-center">
      <div className="text-xl font-bold text-charcoal tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
        {icon}
        {label}
      </div>
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex-1 h-9 rounded-full text-sm font-semibold transition-colors",
        active ? "bg-card text-charcoal shadow-sm" : "text-charcoal-muted hover:text-charcoal",
      )}
    >
      {children}
    </button>
  );
}
