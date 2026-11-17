import { describe, expect, it } from "vitest";
import { formatTripRange, todayISODate } from "./trips";

describe("formatTripRange", () => {
  const thisYear = new Date().getFullYear();
  it("collapses a same-month range", () => {
    expect(formatTripRange(`${thisYear}-12-12`, `${thisYear}-12-19`)).toBe("12 – 19 Dec");
  });
  it("spells both months across a month boundary", () => {
    expect(formatTripRange(`${thisYear}-11-28`, `${thisYear}-12-04`)).toBe("28 Nov – 4 Dec");
  });
  it("adds the year when the trip ends in another year", () => {
    expect(formatTripRange(`${thisYear}-12-28`, `${thisYear + 1}-01-04`)).toBe(
      `28 Dec ${thisYear} – 4 Jan ${thisYear + 1}`,
    );
  });
  it("falls back to raw values for invalid dates", () => {
    expect(formatTripRange("bad", "worse")).toBe("bad – worse");
  });
});

describe("todayISODate", () => {
  it("returns a YYYY-MM-DD string and honours the offset", () => {
    expect(todayISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayISODate(1) > todayISODate()).toBe(true);
  });
});
