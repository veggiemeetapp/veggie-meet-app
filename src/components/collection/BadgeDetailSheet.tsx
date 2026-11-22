import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Lock, MapPin, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/app";
import { PlaceSticker } from "@/components/collection/PlaceSticker";
import {
  FOUNDING_CUTOFF,
  formatCardDate,
  groupStickersByCity,
  type BadgeProgress,
  type Collection,
} from "@/lib/collection";

/**
 * What exactly earned (or is still missing for) a badge: the concrete
 * stickers, connections, meetups or cards behind the number. Connection and
 * meetup records come from `evidence`, which the server only returns for the
 * member's own collection; other members' badges show progress only.
 */
export function BadgeDetailSheet({
  badge,
  data,
  isSelf,
  onClose,
  onShowCards,
}: {
  badge: BadgeProgress | null;
  data: Collection;
  isSelf: boolean;
  onClose: () => void;
  onShowCards: () => void;
}) {
  const navigate = useNavigate();
  const open = !!badge;
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl border-t border-border p-0 max-h-[85dvh] flex flex-col">
        {badge && (
          <>
            <SheetHeader className="page-x pt-6 pb-3 text-left">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${badge.earned ? "bg-soft-green" : "bg-muted grayscale"}`} aria-hidden>
                  {badge.emoji}
                </div>
                <div className="min-w-0">
                  <SheetTitle className="text-lg font-semibold text-charcoal">{badge.name}</SheetTitle>
                  <SheetDescription className="text-sm text-charcoal-muted">
                    {badge.description}{" "}
                    <span className="tabular-nums font-medium text-charcoal">
                      {badge.earned ? "Earned" : `${badge.progress}/${badge.target}`}
                    </span>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="page-x pb-8 overflow-y-auto">
              <BadgeEvidence badge={badge} data={data} isSelf={isSelf} go={go} onShowCards={() => { onClose(); onShowCards(); }} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BadgeEvidence({
  badge,
  data,
  isSelf,
  go,
  onShowCards,
}: {
  badge: BadgeProgress;
  data: Collection;
  isSelf: boolean;
  go: (path: string) => void;
  onShowCards: () => void;
}) {
  const ev = data.evidence;
  const byCity = useMemo(() => groupStickersByCity(data.stickers), [data.stickers]);

  switch (badge.key) {
    case "first_bite":
    case "explorer": {
      if (data.stickers.length === 0) return <Hint text={isSelf ? "Check in at a veggie place, or attend a meetup held there, to collect your first sticker." : "No stickers yet."} />;
      const list = [...data.stickers].sort((a, b) => (a.first_visit_at ?? "").localeCompare(b.first_visit_at ?? ""));
      return (
        <ul className="space-y-2">
          {list.map((s, i) => (
            <li key={s.place_id}>
              <Row
                onClick={() => go(`/place/${s.place_id}`)}
                left={<PlaceSticker placeId={s.place_id} name={s.name} category={s.category} level={s.level} size={40} />}
                title={`${i + 1}. ${s.name}`}
                sub={`${s.city_name ?? "—"} · first visit ${s.first_visit_at ? formatIso(s.first_visit_at) : "—"} · ${s.visits} ${s.visits === 1 ? "visit" : "visits"}`}
              />
            </li>
          ))}
        </ul>
      );
    }
    case "regular": {
      if (data.stickers.length === 0) return <Hint text="Visit the same place 10 times. Check-ins and meetups there both count." />;
      const list = [...data.stickers].sort((a, b) => b.visits - a.visits).slice(0, 10);
      return (
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.place_id}>
              <Row
                onClick={() => go(`/place/${s.place_id}`)}
                left={<PlaceSticker placeId={s.place_id} name={s.name} category={s.category} level={s.level} size={40} />}
                title={s.name}
                sub={`${s.visits}/10 visits · ${s.city_name ?? "—"}`}
                progress={Math.min(1, s.visits / 10)}
              />
            </li>
          ))}
        </ul>
      );
    }
    case "city_hopper": {
      if (byCity.length === 0) return <Hint text="Collect a sticker in three different cities. Trips are a good excuse." />;
      return (
        <ul className="space-y-2">
          {byCity.map((g) => (
            <li key={g.city} className="rounded-card border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-charcoal">
                <MapPin className="w-4 h-4 text-primary" aria-hidden /> {g.city}
                <span className="ml-auto text-xs text-charcoal-muted">{g.stickers.length} {g.stickers.length === 1 ? "sticker" : "stickers"}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {g.stickers.map((s) => (
                  <PlaceSticker key={s.place_id} placeId={s.place_id} name={s.name} category={s.category} level={s.level} size={32} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "social_butterfly": {
      if (!isSelf || !ev) return <Private count={data.stats.verified_connections} noun="verified connection" />;
      if (ev.connections.length === 0) return <Hint text="At a meetup, open “Check in with Veggies” and scan each other's QR with someone you're connected to." />;
      return (
        <ul className="space-y-2">
          {ev.connections.map((c, i) => (
            <li key={`${c.profile_id}-${i}`}>
              <Row
                onClick={c.display_name ? () => go(`/veggie/${c.profile_id}`) : undefined}
                left={<UserAvatar name={c.display_name ?? "Veggie"} src={c.avatar_url ?? undefined} size="sm" />}
                title={c.display_name ?? "A Veggie"}
                sub={
                  c.meetup_title
                    ? `Verified at ${c.meetup_title}${c.meetup_date ? ` · ${formatCardDate(c.meetup_date)}` : ""}`
                    : c.verified_at
                      ? `Verified ${formatIso(c.verified_at)}`
                      : "Verified"
                }
                trailing={c.meetup_id ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); go(`/meetup/${c.meetup_id}`); }} className="text-[11px] font-semibold text-primary shrink-0">
                    Meetup
                  </button>
                ) : null}
              />
            </li>
          ))}
        </ul>
      );
    }
    case "host_hero": {
      if (!isSelf || !ev) return <Private count={data.stats.meetups_hosted} noun="meetup hosted" />;
      if (ev.hosted.length === 0) return <Hint text="Host a meetup and have at least one person check in. Cancelled meetups and ones nobody attended don't count." />;
      return (
        <ul className="space-y-2">
          {ev.hosted.map((m) => (
            <li key={m.meetup_id}>
              <Row
                onClick={() => go(`/meetup/${m.meetup_id}/summary`)}
                left={<Icon><CalendarDays className="w-4 h-4" /></Icon>}
                title={m.title}
                sub={`${formatCardDate(m.date)} · ${m.place_name ?? m.city_name ?? "—"} · ${m.checked_in_count} checked in`}
              />
            </li>
          ))}
        </ul>
      );
    }
    case "memory_keeper": {
      if (data.cards.length === 0) return <Hint text={isSelf ? "After a meetup ends, open its summary and add a photo to make a memory card." : "No memory cards yet."} />;
      return (
        <div className="space-y-3">
          <ul className="space-y-2">
            {data.cards.map((c) => (
              <li key={c.id}>
                <Row
                  onClick={isSelf ? () => go(`/meetup/${c.meetup_id}/summary`) : undefined}
                  left={<img src={c.thumb_data_url} alt="" className="w-10 h-12 rounded-md object-cover bg-muted" />}
                  title={c.title}
                  sub={`${formatCardDate(c.date)}${c.place_name ? ` · ${c.place_name}` : ""}${isSelf && !c.is_public ? " · hidden" : ""}`}
                />
              </li>
            ))}
          </ul>
          <button type="button" onClick={onShowCards} className="text-sm font-semibold text-primary">
            Open the Cards tab
          </button>
        </div>
      );
    }
    case "founding_veggie": {
      const since = data.stats.member_since;
      return (
        <div className="rounded-card border border-border p-3 text-sm text-charcoal space-y-1">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" aria-hidden />
            <span>Member since {since ? formatIso(since) : "—"}</span>
          </div>
          <p className="text-xs text-charcoal-muted">
            Everyone who joined before {formatIso(FOUNDING_CUTOFF)} is a Founding Veggie. {badge.earned ? "That's you." : "This one can no longer be earned."}
          </p>
        </div>
      );
    }
    default:
      return null;
  }
}

function Row({
  left,
  title,
  sub,
  onClick,
  trailing,
  progress,
}: {
  left: React.ReactNode;
  title: string;
  sub: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  progress?: number;
}) {
  const inner = (
    <>
      <div className="shrink-0">{left}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-charcoal truncate">{title}</div>
        <div className="text-xs text-charcoal-muted truncate">{sub}</div>
        {typeof progress === "number" && (
          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      {trailing}
    </>
  );
  const cls = "w-full flex items-center gap-3 rounded-card border border-border p-2.5 text-left";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function Icon({ children }: { children: React.ReactNode }) {
  return <div className="w-10 h-10 rounded-card bg-soft-green text-primary flex items-center justify-center">{children}</div>;
}

function Hint({ text }: { text: string }) {
  return <p className="text-sm text-charcoal-muted">{text}</p>;
}

function Private({ count, noun }: { count: number; noun: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-charcoal-muted">
      <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
      <span>
        {count} {count === 1 ? noun : `${noun}s`}. The people and meetups behind this are only visible to the member.
      </span>
    </div>
  );
}

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default BadgeDetailSheet;
