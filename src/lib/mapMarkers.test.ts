import { describe, expect, it } from "vitest";
import {
  GENERIC_MEETUP_MARKER,
  MEETUP_INTEREST_MARKERS,
  PLACE_STICKER_GROUPS,
  meetupMarkerEmoji,
  placeStickerGroup,
} from "./mapMarkers";

/**
 * WO-152 — the proposed marker taxonomy must cover every active canonical
 * interest and must never hide a Meetup that lacks categorisation.
 */
const ACTIVE_INTEREST_IDS = [
  "live_music",
  "art_museums",
  "photography",
  "reading",
  "volunteering",
  "sustainability",
  "vegan_food",
  "coffee",
  "cooking",
  "dining_out",
  "board_games",
  "hiking",
  "yoga",
  "walking",
  "meditation",
  "running",
  "cycling",
  "fitness",
  "travel",
  "camping",
  "dancing",
  "language_exchange",
  "pilates",
  "festivals",
  "workshops_learning",
  "comedy",
  "climbing",
  "film",
  "food_markets",
  "team_sports",
  "food_tours",
  "racquet_sports",
  "park_days",
  "picnics",
  "karaoke",
];

describe("WO-152 map marker taxonomy", () => {
  it("covers all 35 active canonical interests", () => {
    expect(ACTIVE_INTEREST_IDS).toHaveLength(35);
    expect(Object.keys(MEETUP_INTEREST_MARKERS)).toHaveLength(35);
    for (const id of ACTIVE_INTEREST_IDS) {
      expect(MEETUP_INTEREST_MARKERS[id], id).toBeTruthy();
      expect(meetupMarkerEmoji(id)).toBe(MEETUP_INTEREST_MARKERS[id]);
    }
  });

  it("falls back to a generic marker instead of hiding a Meetup", () => {
    expect(meetupMarkerEmoji(null)).toBe(GENERIC_MEETUP_MARKER);
    expect(meetupMarkerEmoji("")).toBe(GENERIC_MEETUP_MARKER);
    // Retired catalogue id (active = false) must still resolve.
    expect(meetupMarkerEmoji("street_food")).toBe(GENERIC_MEETUP_MARKER);
  });

  it("maps the founder-review fallback matrix to valid Unicode emoji", () => {
    expect(meetupMarkerEmoji("coffee")).toBe("☕");
    expect(meetupMarkerEmoji("karaoke")).toBe("🎤");
    expect(meetupMarkerEmoji("hiking")).toBe("🥾");
    expect(meetupMarkerEmoji("cycling")).toBe("🚲");
    expect(meetupMarkerEmoji("board_games")).toBe("🎲");
    expect(meetupMarkerEmoji("yoga")).toBe("🧘");
    expect(meetupMarkerEmoji("unknown")).toBe("🌱");

    for (const glyph of [...Object.values(MEETUP_INTEREST_MARKERS), GENERIC_MEETUP_MARKER]) {
      expect(glyph).not.toMatch(/[\u25a1\ufffd]/u);
      expect(glyph).toMatch(/[\p{Extended_Pictographic}\u2615]/u);
    }
  });

  it("groups every place_category enum value into a sticker group", () => {
    for (const c of ["restaurant", "cafe", "park", "market", "studio", "venue"]) {
      expect(PLACE_STICKER_GROUPS[c], c).toBeTruthy();
    }
    expect(placeStickerGroup(null)).toBe("other");
    expect(placeStickerGroup("unknown_future_category")).toBe("other");
  });

  it("keeps the sticker taxonomy small (max 7 groups)", () => {
    const groups = new Set(Object.values(PLACE_STICKER_GROUPS));
    groups.add("other");
    expect(groups.size).toBeLessThanOrEqual(7);
  });
});
