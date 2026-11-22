/**
 * Collection — place stickers, meetup memory cards, profile level and badges.
 *
 * Client wrappers for the SECURITY DEFINER RPCs in migration
 * 20261121100000_collection_stickers_cards.sql, plus the pure scoring rules.
 *
 * Design (2026-11-21, after Justin's STIKKA brief):
 *  - A sticker is DERIVED from verified place support (GPS check-ins and
 *    attended meetups held there). The server returns visit counts; nothing
 *    is written when a sticker "unlocks", so stickers can never drift from
 *    the Community Impact numbers members already see.
 *  - Level and badges are computed here from server counts so the rules live
 *    in one testable file and the public profile uses the same math.
 */
import { supabase } from "@/integrations/supabase/client";

type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>).call(supabase, name, args);

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type PlaceCategory = "restaurant" | "cafe" | "park" | "market" | "studio" | "venue";

export interface PlaceSticker {
  place_id: string;
  name: string;
  category: PlaceCategory | string;
  neighborhood: string | null;
  city_name: string | null;
  country_code: string | null;
  is_active: boolean;
  visits: number;
  /** 1..3, see STICKER_THRESHOLDS. */
  level: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
}

export interface UncollectedPlace {
  place_id: string;
  name: string;
  category: PlaceCategory | string;
  neighborhood: string | null;
  city_name: string | null;
}

export interface MemoryCardSummary {
  id: string;
  meetup_id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  city_name: string | null;
  place_name: string | null;
  thumb_data_url: string;
  caption: string;
  is_public: boolean;
  created_at: string;
}

export interface CollectionStats {
  meetups_attended: number;
  meetups_hosted: number;
  verified_connections: number;
  memory_cards: number;
  member_since: string | null;
}

/** A verified real-life connection: who, and at which meetup it was verified. */
export interface ConnectionEvidence {
  profile_id: string;
  /** null when a block exists between the two members (still counts). */
  display_name: string | null;
  avatar_url: string | null;
  verified_at: string | null;
  meetup_id: string | null;
  meetup_title: string | null;
  meetup_date: string | null;
}

export interface HostedEvidence {
  meetup_id: string;
  title: string;
  date: string;
  city_name: string | null;
  place_name: string | null;
  checked_in_count: number;
}

export interface AttendedEvidence {
  meetup_id: string;
  title: string;
  date: string;
  city_name: string | null;
  place_name: string | null;
}

/** Records behind the badges. Only present on the member's own collection. */
export interface CollectionEvidence {
  connections: ConnectionEvidence[];
  hosted: HostedEvidence[];
  attended: AttendedEvidence[];
}

/**
 * A sticker the member can still collect: they checked in to a Meetup held
 * at this place but have not done the GPS place check-in yet. Only place
 * check-ins count as visits (same rule as Community Impact). Own view only.
 */
export interface PendingSticker {
  place_id: string;
  name: string;
  category: PlaceCategory | string;
  city_name: string | null;
  meetup_id: string;
  meetup_title: string;
  /** ISO timestamp when the Meetup ends. */
  ends_at: string;
  /** ISO timestamp until which the hint is shown (meetup end + 4 h). */
  claim_until: string;
  visits_so_far: number;
}

export interface Collection {
  available: boolean;
  profile_id: string;
  stickers: PlaceSticker[];
  uncollected: UncollectedPlace[];
  cards: MemoryCardSummary[];
  stats: CollectionStats;
  evidence: CollectionEvidence | null;
  pending: PendingSticker[];
}

export interface PlaceStickerState {
  found: boolean;
  place_id?: string;
  name?: string;
  category?: string;
  visits: number;
  level: number;
  next_level_visits: number | null;
}

export interface MemoryCardFull {
  available: boolean;
  id?: string;
  profile_id?: string;
  owner_name?: string;
  meetup_id?: string;
  title?: string;
  date?: string;
  city_name?: string | null;
  place_name?: string | null;
  photo_data_url?: string;
  caption?: string;
  is_public?: boolean;
  created_at?: string;
}

export interface MyMemoryCard {
  found: boolean;
  eligible: boolean;
  id?: string;
  photo_data_url?: string;
  thumb_data_url?: string;
  caption?: string;
  is_public?: boolean;
  created_at?: string;
  updated_at?: string;
}

const EMPTY_STATS: CollectionStats = {
  meetups_attended: 0,
  meetups_hosted: 0,
  verified_connections: 0,
  memory_cards: 0,
  member_since: null,
};

function normalizeCollection(raw: Partial<Collection> | null, profileId: string): Collection {
  return {
    available: raw?.available !== false,
    profile_id: raw?.profile_id ?? profileId,
    stickers: raw?.stickers ?? [],
    uncollected: raw?.uncollected ?? [],
    cards: raw?.cards ?? [],
    stats: { ...EMPTY_STATS, ...(raw?.stats ?? {}) },
    evidence: raw?.evidence
      ? {
          connections: raw.evidence.connections ?? [],
          hosted: raw.evidence.hosted ?? [],
          attended: raw.evidence.attended ?? [],
        }
      : null,
    pending: raw?.pending ?? [],
  };
}

/** "in 1h 20m" / "in 3 days" / "any moment now" for a pending sticker. */
export function formatArrival(endsAt: string, now: Date = new Date()): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 60_000) return "any moment now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/* ------------------------------------------------------------------ *
 * RPC wrappers
 * ------------------------------------------------------------------ */

export async function fetchMyCollection(): Promise<Collection> {
  const { data, error } = await rpc<Collection>("get_my_collection");
  if (error) throw new Error(error.message);
  return normalizeCollection(data, "");
}

export async function fetchPublicCollection(profileId: string): Promise<Collection> {
  const { data, error } = await rpc<Collection>("get_public_collection", { _profile_id: profileId });
  if (error) throw new Error(error.message);
  return normalizeCollection(data, profileId);
}

export async function fetchMyPlaceSticker(placeId: string): Promise<PlaceStickerState> {
  const { data, error } = await rpc<PlaceStickerState>("get_my_place_sticker", { _place_id: placeId });
  if (error) throw new Error(error.message);
  return { found: false, visits: 0, level: 0, next_level_visits: 1, ...(data ?? {}) };
}

export async function fetchMemoryCard(cardId: string): Promise<MemoryCardFull> {
  const { data, error } = await rpc<MemoryCardFull>("get_memory_card", { _card_id: cardId });
  if (error) throw new Error(error.message);
  return data ?? { available: false };
}

export async function fetchMyMemoryCard(meetupId: string): Promise<MyMemoryCard> {
  const { data, error } = await rpc<MyMemoryCard>("get_my_memory_card", { _meetup_id: meetupId });
  if (error) throw new Error(error.message);
  return { found: false, eligible: false, ...(data ?? {}) };
}

export async function saveMemoryCard(input: {
  meetupId: string;
  photoDataUrl: string;
  thumbDataUrl: string;
  caption: string;
}): Promise<string> {
  const { data, error } = await rpc<string>("upsert_meetup_memory_card", {
    _meetup_id: input.meetupId,
    _photo: input.photoDataUrl,
    _thumb: input.thumbDataUrl,
    _caption: input.caption,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateMemoryCard(input: {
  meetupId: string;
  caption?: string | null;
  isPublic?: boolean | null;
}): Promise<boolean> {
  const { data, error } = await rpc<boolean>("update_memory_card_caption", {
    _meetup_id: input.meetupId,
    _caption: input.caption ?? null,
    _is_public: input.isPublic ?? null,
  });
  if (error) throw new Error(error.message);
  return !!data;
}

export async function deleteMemoryCard(meetupId: string): Promise<boolean> {
  const { data, error } = await rpc<boolean>("delete_meetup_memory_card", { _meetup_id: meetupId });
  if (error) throw new Error(error.message);
  return !!data;
}

/* ------------------------------------------------------------------ *
 * Sticker rules (pure)
 * ------------------------------------------------------------------ */

/** Visits needed for level 1, 2, 3. Must match `_sticker_level()` in SQL. */
export const STICKER_THRESHOLDS = [1, 3, 10] as const;
export const STICKER_MAX_LEVEL = STICKER_THRESHOLDS.length;

export function stickerLevel(visits: number): number {
  let level = 0;
  for (const t of STICKER_THRESHOLDS) if (visits >= t) level += 1;
  return level;
}

/** Visits required for the next level, or null at max level. */
export function nextStickerThreshold(visits: number): number | null {
  for (const t of STICKER_THRESHOLDS) if (visits < t) return t;
  return null;
}

export const STICKER_LEVEL_LABEL: Record<number, string> = {
  0: "Not collected",
  1: "First visit",
  2: "Regular",
  3: "Local legend",
};

export const CATEGORY_EMOJI: Record<string, string> = {
  restaurant: "🍜",
  cafe: "☕",
  park: "🌳",
  market: "🧺",
  studio: "🧘",
  venue: "🎪",
};

export function categoryEmoji(category: string | null | undefined): string {
  return CATEGORY_EMOJI[(category ?? "").toLowerCase()] ?? "🌱";
}

/** Deterministic hue (0..359) from a place id, so a sticker always looks the same. */
export function stickerHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}

/* ------------------------------------------------------------------ *
 * Profile level (pure)
 * ------------------------------------------------------------------ */

export const LEVEL_POINTS = {
  perPlace: 10,
  perExtraVisit: 3,
  extraVisitsCapPerPlace: 20,
  perMeetupAttended: 15,
  perMeetupHosted: 25,
  perConnection: 10,
} as const;

export const LEVELS: ReadonlyArray<{ level: number; name: string; min: number }> = [
  { level: 1, name: "Sprout", min: 0 },
  { level: 2, name: "Seedling", min: 40 },
  { level: 3, name: "Leaf", min: 100 },
  { level: 4, name: "Bloom", min: 200 },
  { level: 5, name: "Grove", min: 350 },
  { level: 6, name: "Canopy", min: 550 },
  { level: 7, name: "Forest", min: 800 },
  { level: 8, name: "Legend", min: 1200 },
];

export interface LevelBreakdown {
  places: number;
  extraVisits: number;
  meetupsAttended: number;
  meetupsHosted: number;
  connections: number;
}

export interface ProfileLevel {
  level: number;
  name: string;
  points: number;
  /** Points at which the current level started. */
  currentMin: number;
  /** Points needed for the next level, or null at the top. */
  nextMin: number | null;
  /** 0..1 progress inside the current level (1 at the top). */
  progress: number;
  breakdown: LevelBreakdown;
}

export function collectionPoints(stickers: Pick<PlaceSticker, "visits">[], stats: CollectionStats): { points: number; breakdown: LevelBreakdown } {
  const places = stickers.length;
  const extraVisits = stickers.reduce(
    (sum, s) => sum + Math.min(Math.max(s.visits - 1, 0), LEVEL_POINTS.extraVisitsCapPerPlace),
    0,
  );
  const breakdown: LevelBreakdown = {
    places,
    extraVisits,
    meetupsAttended: Math.max(stats.meetups_attended, 0),
    meetupsHosted: Math.max(stats.meetups_hosted, 0),
    connections: Math.max(stats.verified_connections, 0),
  };
  const points =
    breakdown.places * LEVEL_POINTS.perPlace +
    breakdown.extraVisits * LEVEL_POINTS.perExtraVisit +
    breakdown.meetupsAttended * LEVEL_POINTS.perMeetupAttended +
    breakdown.meetupsHosted * LEVEL_POINTS.perMeetupHosted +
    breakdown.connections * LEVEL_POINTS.perConnection;
  return { points, breakdown };
}

export function levelForPoints(points: number): ProfileLevel["level"] {
  let current = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) current = l;
  return current.level;
}

export function profileLevel(stickers: Pick<PlaceSticker, "visits">[], stats: CollectionStats): ProfileLevel {
  const { points, breakdown } = collectionPoints(stickers, stats);
  const level = levelForPoints(points);
  const idx = LEVELS.findIndex((l) => l.level === level);
  const current = LEVELS[idx];
  const next = LEVELS[idx + 1] ?? null;
  const span = next ? next.min - current.min : 1;
  const progress = next ? Math.min(1, Math.max(0, (points - current.min) / span)) : 1;
  return {
    level,
    name: current.name,
    points,
    currentMin: current.min,
    nextMin: next ? next.min : null,
    progress,
    breakdown,
  };
}

/* ------------------------------------------------------------------ *
 * Badges (pure, computed on read)
 * ------------------------------------------------------------------ */

export type BadgeKey =
  | "first_bite"
  | "explorer"
  | "regular"
  | "city_hopper"
  | "social_butterfly"
  | "host_hero"
  | "memory_keeper"
  | "founding_veggie";

export interface BadgeDefinition {
  key: BadgeKey;
  name: string;
  emoji: string;
  description: string;
  target: number;
}

/** Members whose profile was created before this date are founders. */
export const FOUNDING_CUTOFF = "2027-01-01T00:00:00Z";

export const BADGES: readonly BadgeDefinition[] = [
  { key: "first_bite", name: "First Bite", emoji: "🥢", description: "Collect your first place sticker.", target: 1 },
  { key: "explorer", name: "Explorer", emoji: "🧭", description: "Collect stickers from 10 different places.", target: 10 },
  { key: "regular", name: "Regular", emoji: "⭐", description: "Visit one place 10 times.", target: 10 },
  { key: "city_hopper", name: "City Hopper", emoji: "🛵", description: "Collect stickers in 3 different cities.", target: 3 },
  { key: "social_butterfly", name: "Social Butterfly", emoji: "🦋", description: "Verify 10 real-life connections.", target: 10 },
  { key: "host_hero", name: "Host Hero", emoji: "🎉", description: "Host 5 meetups that people showed up to.", target: 5 },
  { key: "memory_keeper", name: "Memory Keeper", emoji: "📸", description: "Save 5 meetup memory cards.", target: 5 },
  { key: "founding_veggie", name: "Founding Veggie", emoji: "🌱", description: "Joined VeggieMeet in its first season.", target: 1 },
];

export interface BadgeProgress extends BadgeDefinition {
  progress: number;
  earned: boolean;
}

export function evaluateBadges(
  stickers: Pick<PlaceSticker, "visits" | "city_name" | "country_code">[],
  stats: CollectionStats,
  now: Date = new Date(),
): BadgeProgress[] {
  const places = stickers.length;
  const maxVisits = stickers.reduce((m, s) => Math.max(m, s.visits), 0);
  const cities = new Set(
    stickers.map((s) => `${s.country_code ?? ""}:${(s.city_name ?? "").toLowerCase()}`).filter((k) => k !== ":"),
  ).size;
  const founding =
    !!stats.member_since &&
    new Date(stats.member_since).getTime() < new Date(FOUNDING_CUTOFF).getTime() &&
    new Date(stats.member_since).getTime() <= now.getTime();

  const progressFor: Record<BadgeKey, number> = {
    first_bite: Math.min(places, 1),
    explorer: places,
    regular: maxVisits,
    city_hopper: cities,
    social_butterfly: stats.verified_connections,
    host_hero: stats.meetups_hosted,
    memory_keeper: stats.memory_cards,
    founding_veggie: founding ? 1 : 0,
  };

  return BADGES.map((b) => {
    const progress = Math.max(0, progressFor[b.key]);
    return { ...b, progress: Math.min(progress, b.target), earned: progress >= b.target };
  });
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

/** "Da Nang" | "Unknown city" grouping key for the sticker grid. */
export function stickerCityLabel(s: Pick<PlaceSticker, "city_name">): string {
  return s.city_name?.trim() || "Other places";
}

export function groupStickersByCity(stickers: PlaceSticker[]): { city: string; stickers: PlaceSticker[] }[] {
  const map = new Map<string, PlaceSticker[]>();
  for (const s of stickers) {
    const key = stickerCityLabel(s);
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([city, list]) => ({ city, stickers: list }))
    .sort((a, b) => b.stickers.length - a.stickers.length || a.city.localeCompare(b.city));
}

export function formatCardDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
