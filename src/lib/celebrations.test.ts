import { beforeEach, describe, expect, it } from "vitest";
import { diffNewlyEarned, levelWentUp, takeLevelUp, takeNewlyEarnedBadges } from "./celebrations";

describe("celebrations", () => {
  beforeEach(() => localStorage.clear());

  it("diffs newly earned badges against the seen set", () => {
    expect(diffNewlyEarned(new Set(["a"]), ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(diffNewlyEarned(new Set(), [])).toEqual([]);
  });

  it("first look records everything silently, later looks surface only new ones", () => {
    expect(takeNewlyEarnedBadges("p1", ["first_bite"])).toEqual([]);
    expect(takeNewlyEarnedBadges("p1", ["first_bite"])).toEqual([]);
    expect(takeNewlyEarnedBadges("p1", ["first_bite", "explorer"])).toEqual(["explorer"]);
    expect(takeNewlyEarnedBadges("p1", ["first_bite", "explorer"])).toEqual([]);
  });

  it("keeps members separate", () => {
    takeNewlyEarnedBadges("p1", ["first_bite"]);
    expect(takeNewlyEarnedBadges("p2", ["first_bite"])).toEqual([]);
    expect(takeNewlyEarnedBadges("p2", ["first_bite", "regular"])).toEqual(["regular"]);
  });

  it("detects a level-up once", () => {
    expect(levelWentUp(null, 2)).toBe(false);
    expect(levelWentUp(2, 2)).toBe(false);
    expect(levelWentUp(2, 3)).toBe(true);
    expect(takeLevelUp("p1", 1)).toBe(false);
    expect(takeLevelUp("p1", 1)).toBe(false);
    expect(takeLevelUp("p1", 2)).toBe(true);
    expect(takeLevelUp("p1", 2)).toBe(false);
  });
});
