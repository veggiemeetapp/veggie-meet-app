import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Camera, Sparkles, Sticker } from "lucide-react";
import { Card, EmptyState } from "@/components/app";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { Stagger } from "@/components/app/Stagger";
import { AnimatedNumber } from "@/components/app/AnimatedNumber";
import { takeNewlyEarnedBadges } from "@/lib/celebrations";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMemoryCard } from "@/hooks/useCollection";
import { PlaceCoverProvider, PlaceSticker } from "@/components/collection/PlaceSticker";
import { MemoryCardFrame } from "@/components/collection/MemoryCardTile";
import { BadgeTile } from "@/components/collection/BadgeTile";
import { BadgeDetailSheet } from "@/components/collection/BadgeDetailSheet";
import {
  evaluateBadges,
  formatArrival,
  groupStickersByCity,
  nextStickerThreshold,
  STICKER_LEVEL_LABEL,
  type BadgeProgress,
  type Collection as CollectionData,
  type PlaceSticker as PlaceStickerData,
} from "@/lib/collection";

export type CollectionTab = "stickers" | "cards" | "badges";
type Tab = CollectionTab;

/**
 * The Stickers / Cards / Badges body of a collection, shared by the member's
 * own profile (inline, per Justin's 2026-11-23 feedback) and the standalone
 * Collection screen (own + other members). Owns its tab state, the card
 * dialog and the badge detail sheet; fetches nothing itself.
 */
export function CollectionPanel({
  data,
  isSelf,
  firstName,
  showStats = true,
  showHowPoints = true,
  initialTab = "stickers",
  tab: controlledTab,
  onTabChange,
}: {
  data: CollectionData;
  isSelf: boolean;
  firstName: string;
  showStats?: boolean;
  showHowPoints?: boolean;
  initialTab?: Tab;
  /** Controlled tab (the profile's progress card drives it); omit to let the panel own it. */
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
}) {
  const navigate = useNavigate();
  const [ownTab, setOwnTab] = useState<Tab>(initialTab);
  const tab = controlledTab ?? ownTab;
  const setTab = (next: Tab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openBadge, setOpenBadge] = useState<BadgeProgress | null>(null);

  const badges = useMemo(() => evaluateBadges(data.stickers, data.stats), [data]);
  const earnedCount = badges.filter((b) => b.earned).length;
  // Badges earned since the member last looked (own view only, per device).
  const [newBadges, setNewBadges] = useState<Set<string>>(() => new Set());
  const earnedKeys = badges.filter((b) => b.earned).map((b) => b.key).join(",");
  useEffect(() => {
    if (!isSelf || !data.profile_id) return;
    const fresh = takeNewlyEarnedBadges(data.profile_id, earnedKeys ? earnedKeys.split(",") : []);
    if (fresh.length) setNewBadges((prev) => new Set([...prev, ...fresh]));
  }, [isSelf, data.profile_id, earnedKeys]);
  const coverIds = useMemo(
    () => [...data.stickers.map((x) => x.place_id), ...data.uncollected.map((x) => x.place_id), ...data.pending.map((x) => x.place_id)],
    [data],
  );

  return (
    <PlaceCoverProvider placeIds={coverIds}>
      <div className="space-y-4" data-testid="collection-panel">
        {showStats && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Stickers" value={data.stickers.length} icon={<Sticker className="w-3.5 h-3.5" />} />
            <Stat label="Cards" value={data.cards.length} icon={<Camera className="w-3.5 h-3.5" />} />
            <Stat label="Badges" value={earnedCount} icon={<Award className="w-3.5 h-3.5" />} />
          </div>
        )}

        <SegmentedTabs<Tab>
          ariaLabel="Collection sections"
          items={[
            { key: "stickers", label: "Stickers" },
            { key: "cards", label: "Cards" },
            { key: "badges", label: newBadges.size ? `Badges · ${newBadges.size} new` : "Badges" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {/* key={tab} remounts the body so the tab-in animation plays on every switch */}
        <div key={tab} className="motion-safe:animate-tab-in">
          {tab === "stickers" && (
            <StickersTab data={data} isSelf={isSelf} firstName={firstName} onPlace={(pid) => navigate(`/place/${pid}`)} />
          )}
          {tab === "cards" && <CardsTab data={data} isSelf={isSelf} firstName={firstName} onOpen={setOpenCard} />}
          {tab === "badges" && (
            <div className="space-y-2">
              <p className="px-1 text-xs text-charcoal-muted">Tap a badge to see what counts toward it.</p>
              <Stagger className="space-y-2">
                {badges.map((b) => (
                  <BadgeTile key={b.key} badge={b} isNew={newBadges.has(b.key)} onClick={() => setOpenBadge(b)} />
                ))}
              </Stagger>
            </div>
          )}
        </div>

        {isSelf && showHowPoints && (
          <Card padding="md" className="text-xs text-charcoal-muted space-y-1">
            <div className="flex items-center gap-1.5 text-charcoal font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> How points work
            </div>
            <p>
              10 per place you support, 3 per return visit, 15 per meetup you attend, 25 per meetup you host that
              people show up to, and 10 per verified connection. A visit counts when you verify it on the place page
              (location on, within 150 m), the same rule as Community Impact.
            </p>
          </Card>
        )}

        <MemoryCardDialog cardId={openCard} onClose={() => setOpenCard(null)} />
        <BadgeDetailSheet
          badge={openBadge}
          data={data}
          isSelf={isSelf}
          onClose={() => setOpenBadge(null)}
          onShowCards={() => setTab("cards")}
        />
      </div>
    </PlaceCoverProvider>
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
  const navigate = useNavigate();
  const onCollect = (placeId: string) => navigate(`/place/${placeId}?checkin=1&from=collection`);
  const groups = useMemo(() => groupStickersByCity(data.stickers), [data.stickers]);

  return (
    <div className="space-y-6">
      {data.stickers.length === 0 ? (
        <EmptyState
          icon={<Sticker className="w-5 h-5" />}
          title={isSelf ? "No stickers yet" : `${firstName} hasn't collected stickers yet`}
          description={
            isSelf ? "Verify a visit at a veggie place (location on, within 150 m) to peel your first sticker." : undefined
          }
        />
      ) : (
        groups.map((g) => (
          <section key={g.city} aria-label={`${g.city} stickers`}>
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
              {g.city} · {g.stickers.length}
            </h3>
            <Stagger className="grid grid-cols-3 gap-3">
              {g.stickers.map((s) => (
                <StickerTile key={s.place_id} sticker={s} onClick={() => onPlace(s.place_id)} />
              ))}
            </Stagger>
          </section>
        ))
      )}

      {isSelf && data.pending.length > 0 && (
        <section aria-label="Stickers waiting for you">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-1">Waiting for you</h3>
          <p className="px-1 text-xs text-charcoal-muted mb-2">
            You said “I'm here” at a meetup at these places. Stickers need a verified visit, so tap Collect while
            you're there.
          </p>
          <ul className="space-y-2">
            {data.pending.map((p) => (
              <li key={`${p.place_id}-${p.meetup_id}`}>
                <button
                  type="button"
                  onClick={() => onCollect(p.place_id)}
                  className="w-full flex items-center gap-3 rounded-card border border-dashed border-border-strong p-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <PlaceSticker placeId={p.place_id} name={p.name} category={p.category} level={0} muted size={48} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-charcoal truncate">{p.name}</div>
                    <div className="text-xs text-charcoal-muted truncate">
                      {p.meetup_title} · {new Date(p.ends_at).getTime() > Date.now() ? `ends ${formatArrival(p.ends_at)}` : "ended"}
                    </div>
                    <div className="text-[11px] text-primary">
                      {p.visits_so_far > 0 ? `Would be visit ${p.visits_so_far + 1}` : "Would be your first visit here"}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-primary">Collect</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isSelf && data.uncollected.length > 0 && (
        <section aria-label="Places to collect">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-1">Not collected yet</h3>
          <p className="px-1 text-xs text-charcoal-muted mb-2">
            Verified places in your city you haven't visited. Tap one to plan your next bite.
          </p>
          <Stagger className="grid grid-cols-3 gap-3">
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
          </Stagger>
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
          isSelf ? "After a meetup ends, open its summary from Past meetups and add a photo to turn it into a card." : undefined
        }
      />
    );
  }
  return (
    <Stagger className="grid grid-cols-2 gap-3">
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
    </Stagger>
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
      <div className="text-xl font-bold text-charcoal tabular-nums leading-none"><AnimatedNumber value={value} /></div>
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
        {icon}
        {label}
      </div>
    </Card>
  );
}

export default CollectionPanel;
