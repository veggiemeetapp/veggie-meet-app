import { beforeEach, describe, expect, it } from "vitest";
import {
  MOCK_MEETUPS,
  mockDeleteCard,
  mockMemoryCard,
  mockMyCollection,
  mockMyMemoryCard,
  mockPlaceSticker,
  mockPublicCollection,
  mockSaveCard,
  mockUpdateCard,
  resetCollectionMock,
  samplePhotoDataUrl,
} from "./collectionMock";
import { evaluateBadges, profileLevel } from "./collection";

describe("collection mock", () => {
  beforeEach(() => resetCollectionMock());

  it("covers every sticker level and several cities", () => {
    const c = mockMyCollection();
    const levels = new Set(c.stickers.map((s) => s.level));
    expect(levels).toEqual(new Set([1, 2, 3]));
    expect(new Set(c.stickers.map((s) => s.city_name)).size).toBeGreaterThanOrEqual(3);
    expect(c.uncollected.length).toBeGreaterThan(0);
    expect(c.cards.length).toBe(3);
  });

  it("gives a mid-level profile and a mix of earned and pending badges", () => {
    const c = mockMyCollection();
    const level = profileLevel(c.stickers, c.stats);
    expect(level.level).toBeGreaterThanOrEqual(3);
    expect(level.nextMin).not.toBeNull();
    const badges = evaluateBadges(c.stickers, c.stats);
    expect(badges.some((b) => b.earned)).toBe(true);
    expect(badges.some((b) => !b.earned)).toBe(true);
  });

  it("public view hides hidden cards and suggestions", () => {
    const pub = mockPublicCollection("x");
    expect(pub.uncollected).toEqual([]);
    expect(pub.cards.every((c) => c.is_public)).toBe(true);
    expect(pub.cards.length).toBe(2);
  });

  it("round-trips save, update, delete without touching the network", () => {
    const meetupId = MOCK_MEETUPS[3].id;
    expect(mockMyMemoryCard(meetupId)).toEqual({ found: false, eligible: true });
    const id = mockSaveCard({ meetupId, photoDataUrl: "data:p", thumbDataUrl: "data:t", caption: "hi" });
    expect(mockMyMemoryCard(meetupId).found).toBe(true);
    expect(mockMemoryCard(id).available).toBe(true);
    expect(mockUpdateCard({ meetupId, isPublic: false })).toBe(true);
    expect(mockPublicCollection("x").cards.find((c) => c.id === id)).toBeUndefined();
    expect(mockDeleteCard(meetupId)).toBe(true);
    expect(mockDeleteCard(meetupId)).toBe(false);
  });

  it("returns a deterministic sticker for unknown place ids", () => {
    const a = mockPlaceSticker("real-place-id");
    expect(a.found).toBe(true);
    expect(a.visits).toBeGreaterThanOrEqual(1);
    expect(mockPlaceSticker("real-place-id")).toEqual(a);
  });

  it("builds an SVG data URL photo", () => {
    expect(samplePhotoDataUrl("s", "Sample")).toMatch(/^data:image\/svg\+xml;utf8,/);
  });
});
