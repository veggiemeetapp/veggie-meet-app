/**
 * WO-152 — proposed marker semantics for the future Ecosystem Map.
 *
 * This module is DATA ONLY. It is consumed by the private owner map lab
 * prototype (`/owner/map-lab`) and is not referenced by any member-facing
 * surface. Nothing here changes existing behaviour.
 *
 * Meetup markers derive from the canonical Main interest (`meetups.primary_interest_id`),
 * never from the legacy `meetup_category` enum. Every one of the 35 active
 * interest ids in `interest_catalogue` has a deterministic emoji; retired ids
 * and NULL fall through to the generic marker so a Meetup with valid
 * coordinates is never hidden for lack of categorisation.
 */

export const GENERIC_MEETUP_MARKER = "🌱";

/** Canonical Main interest id → marker emoji (all 35 active catalogue ids). */
export const MEETUP_INTEREST_MARKERS: Record<string, string> = {
  // Food & drink
  vegan_food: "🥗",
  coffee: "☕",
  cooking: "🍳",
  dining_out: "🍽️",
  food_markets: "🧺",
  food_tours: "🍜",
  // Movement & wellness
  hiking: "🥾",
  yoga: "🧘",
  walking: "🚶",
  meditation: "🕯️",
  running: "🏃",
  cycling: "🚲",
  fitness: "💪",
  pilates: "🤸",
  climbing: "🧗",
  team_sports: "⚽",
  racquet_sports: "🏸",
  // Outdoors & nature
  travel: "🧭",
  camping: "🏕️",
  park_days: "🌳",
  picnics: "🧺",
  // Arts & culture
  live_music: "🎶",
  art_museums: "🖼️",
  photography: "📷",
  reading: "📚",
  film: "🎬",
  dancing: "💃",
  comedy: "🎭",
  karaoke: "🎤",
  festivals: "🎉",
  // Learning & making
  board_games: "🎲",
  workshops_learning: "🛠️",
  language_exchange: "🗣️",
  // Community & purpose
  volunteering: "🤝",
  sustainability: "♻️",
};

export function meetupMarkerEmoji(primaryInterestId?: string | null): string {
  if (!primaryInterestId) return GENERIC_MEETUP_MARKER;
  return MEETUP_INTEREST_MARKERS[primaryInterestId] ?? GENERIC_MEETUP_MARKER;
}

/** Proposed V1 sticker groups for Community Places (6 groups, no artwork yet). */
export type PlaceStickerGroup = "eatery" | "cafe" | "shop" | "outdoors" | "venue" | "other";

/** `place_category` enum value → sticker group. */
export const PLACE_STICKER_GROUPS: Record<string, PlaceStickerGroup> = {
  restaurant: "eatery",
  cafe: "cafe",
  market: "shop",
  park: "outdoors",
  studio: "venue",
  venue: "venue",
};

export const PLACE_STICKER_PLACEHOLDERS: Record<PlaceStickerGroup, string> = {
  eatery: "🍽️",
  cafe: "☕",
  shop: "🛍️",
  outdoors: "🌳",
  venue: "🎪",
  other: "📍",
};

export function placeStickerGroup(category?: string | null): PlaceStickerGroup {
  if (!category) return "other";
  return PLACE_STICKER_GROUPS[category] ?? "other";
}
