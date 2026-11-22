import { describe, expect, it } from "vitest";
import {
  evaluateBadges,
  formatArrival,
  groupStickersByCity,
  levelForPoints,
  nextStickerThreshold,
  profileLevel,
  stickerHue,
  stickerLevel,
  type CollectionStats,
  type PlaceSticker,
} from "./collection";

const stats = (over: Partial<CollectionStats> = {}): CollectionStats => ({
  meetups_attended: 0,
  meetups_hosted: 0,
  verified_connections: 0,
  memory_cards: 0,
  member_since: "2026-11-01T00:00:00Z",
  ...over,
});

const sticker = (over: Partial<PlaceSticker> = {}): PlaceSticker => ({
  place_id: "p1",
  name: "Green Bowl",
  category: "restaurant",
  neighborhood: null,
  city_name: "Da Nang",
  country_code: "VN",
  is_active: true,
  visits: 1,
  level: 1,
  first_visit_at: null,
  last_visit_at: null,
  ...over,
});

describe("sticker levels", () => {
  it("maps visits to 0..3 and matches the SQL thresholds", () => {
    expect(stickerLevel(0)).toBe(0);
    expect(stickerLevel(1)).toBe(1);
    expect(stickerLevel(2)).toBe(1);
    expect(stickerLevel(3)).toBe(2);
    expect(stickerLevel(9)).toBe(2);
    expect(stickerLevel(10)).toBe(3);
    expect(stickerLevel(50)).toBe(3);
  });

  it("reports the next threshold or null at the top", () => {
    expect(nextStickerThreshold(0)).toBe(1);
    expect(nextStickerThreshold(1)).toBe(3);
    expect(nextStickerThreshold(5)).toBe(10);
    expect(nextStickerThreshold(10)).toBeNull();
  });

  it("gives a stable hue per place id", () => {
    expect(stickerHue("abc")).toBe(stickerHue("abc"));
    expect(stickerHue("abc")).not.toBe(stickerHue("abd"));
    expect(stickerHue("x")).toBeGreaterThanOrEqual(0);
    expect(stickerHue("x")).toBeLessThan(360);
  });
});

describe("profile level", () => {
  it("starts at Sprout with no activity", () => {
    const l = profileLevel([], stats());
    expect(l.level).toBe(1);
    expect(l.name).toBe("Sprout");
    expect(l.points).toBe(0);
    expect(l.nextMin).toBe(40);
    expect(l.progress).toBe(0);
  });

  it("adds points per place, extra visit, meetup and connection", () => {
    const l = profileLevel(
      [sticker({ visits: 4 }), sticker({ place_id: "p2", visits: 1 })],
      stats({ meetups_attended: 2, meetups_hosted: 1, verified_connections: 3 }),
    );
    // places 2×10 + extra visits 3×3 + attended 2×15 + hosted 1×25 + connections 3×10
    expect(l.points).toBe(20 + 9 + 30 + 25 + 30);
    expect(l.level).toBe(3);
    expect(l.name).toBe("Leaf");
    expect(l.breakdown.extraVisits).toBe(3);
  });

  it("caps extra visits per place so one favourite can't farm levels", () => {
    const l = profileLevel([sticker({ visits: 500 })], stats());
    expect(l.breakdown.extraVisits).toBe(20);
    expect(l.points).toBe(10 + 60);
  });

  it("tops out at Legend with progress 1", () => {
    expect(levelForPoints(1199)).toBe(7);
    expect(levelForPoints(1200)).toBe(8);
    const l = profileLevel([], stats({ meetups_hosted: 100 }));
    expect(l.level).toBe(8);
    expect(l.nextMin).toBeNull();
    expect(l.progress).toBe(1);
  });
});

describe("badges", () => {
  it("earns First Bite and Founding Veggie for an early member with one sticker", () => {
    const badges = evaluateBadges([sticker()], stats(), new Date("2026-11-21T00:00:00Z"));
    const by = Object.fromEntries(badges.map((b) => [b.key, b]));
    expect(by.first_bite.earned).toBe(true);
    expect(by.founding_veggie.earned).toBe(true);
    expect(by.explorer.earned).toBe(false);
    expect(by.explorer.progress).toBe(1);
  });

  it("does not grant Founding Veggie after the cutoff", () => {
    const badges = evaluateBadges([], stats({ member_since: "2027-03-01T00:00:00Z" }));
    expect(badges.find((b) => b.key === "founding_veggie")?.earned).toBe(false);
  });

  it("counts distinct cities and the best single place", () => {
    const badges = evaluateBadges(
      [
        sticker({ place_id: "a", city_name: "Da Nang", visits: 10 }),
        sticker({ place_id: "b", city_name: "Hoi An" }),
        sticker({ place_id: "c", city_name: "Bangkok", country_code: "TH" }),
        sticker({ place_id: "d", city_name: "Da Nang" }),
      ],
      stats({ memory_cards: 5, verified_connections: 12, meetups_hosted: 4 }),
    );
    const by = Object.fromEntries(badges.map((b) => [b.key, b]));
    expect(by.city_hopper.earned).toBe(true);
    expect(by.regular.earned).toBe(true);
    expect(by.memory_keeper.earned).toBe(true);
    expect(by.social_butterfly.earned).toBe(true);
    expect(by.host_hero.earned).toBe(false);
    expect(by.host_hero.progress).toBe(4);
  });
});

describe("groupStickersByCity", () => {
  it("groups by city, biggest group first, unknown city last-named", () => {
    const groups = groupStickersByCity([
      sticker({ place_id: "a", city_name: "Hoi An" }),
      sticker({ place_id: "b", city_name: "Da Nang" }),
      sticker({ place_id: "c", city_name: "Da Nang" }),
      sticker({ place_id: "d", city_name: null }),
    ]);
    expect(groups.map((g) => g.city)).toEqual(["Da Nang", "Hoi An", "Other places"]);
    expect(groups[0].stickers).toHaveLength(2);
  });
});

describe("formatArrival", () => {
  const now = new Date("2026-11-22T10:00:00Z");
  it("formats minutes, hours and days", () => {
    expect(formatArrival("2026-11-22T10:00:30Z", now)).toBe("any moment now");
    expect(formatArrival("2026-11-22T10:25:00Z", now)).toBe("in 25 min");
    expect(formatArrival("2026-11-22T11:20:00Z", now)).toBe("in 1h 20m");
    expect(formatArrival("2026-11-22T13:00:00Z", now)).toBe("in 3h");
    expect(formatArrival("2026-11-25T10:00:00Z", now)).toBe("in 3 days");
  });
});
