import { describe, it, expect } from "vitest";
import {
  normalizeClockTime,
  formatMeetupTimeRange,
  formatDuration,
} from "@/lib/format";

/** WO-112 — optional Meetup end time formatting. */
describe("normalizeClockTime", () => {
  it("normalises accepted shapes", () => {
    expect(normalizeClockTime("18:30:00")).toBe("18:30");
    expect(normalizeClockTime("9:05")).toBe("09:05");
  });
  it("returns null for missing or unusable values", () => {
    expect(normalizeClockTime(null)).toBeNull();
    expect(normalizeClockTime("")).toBeNull();
    expect(normalizeClockTime("  ")).toBeNull();
    expect(normalizeClockTime("later")).toBeNull();
  });
});

describe("formatMeetupTimeRange", () => {
  it("renders a range when an end time exists", () => {
    expect(formatMeetupTimeRange("18:30", "20:00")).toBe("6:30 PM – 8:00 PM");
    expect(formatMeetupTimeRange("18:30:00", "20:00:00")).toBe("6:30 PM – 8:00 PM");
  });
  it("collapses to the start time when there is no end time", () => {
    expect(formatMeetupTimeRange("18:30", null)).toBe("6:30 PM");
    expect(formatMeetupTimeRange("18:30", "")).toBe("6:30 PM");
    expect(formatMeetupTimeRange("18:30", undefined)).toBe("6:30 PM");
    expect(formatMeetupTimeRange("18:30", "18:30")).toBe("6:30 PM");
  });
  it("never emits undefined or a dangling dash", () => {
    const out = formatMeetupTimeRange("07:00", null);
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("–");
  });
});

describe("formatDuration", () => {
  it("computes a duration when both times exist", () => {
    expect(formatDuration("18:30", "20:00")).toBe("1h 30m");
    expect(formatDuration("18:00", "20:00")).toBe("2h");
  });
  it("returns null without an end time", () => {
    expect(formatDuration("18:30", null)).toBeNull();
    expect(formatDuration("18:30", "18:30")).toBeNull();
  });
});
