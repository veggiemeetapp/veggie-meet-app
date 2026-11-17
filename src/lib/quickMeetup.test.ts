import { describe, expect, it } from "vitest";
import { QUICK_MEETUP_PRESETS, quickMeetupPrefill, quickMeetupPreset } from "./quickMeetup";

const at = (h: number, m = 0) => new Date(2026, 10, 17, h, m);
const coffee = quickMeetupPreset("coffee")!;
const dinner = quickMeetupPreset("dinner")!;

describe("quickMeetupPreset", () => {
  it("resolves known keys and rejects unknown ones", () => {
    expect(quickMeetupPreset("lunch")?.title).toBe("Vegan lunch together");
    expect(quickMeetupPreset("party")).toBeNull();
    expect(quickMeetupPreset(null)).toBeNull();
    expect(QUICK_MEETUP_PRESETS.map((p) => p.key)).toEqual(["coffee", "lunch", "dinner", "walk"]);
  });
});

describe("quickMeetupPrefill", () => {
  it("picks the next half-hour slot at least 45 minutes away", () => {
    const p = quickMeetupPrefill(coffee, at(10, 5));
    expect(p.date).toBe("2026-11-17");
    expect(p.startTime).toBe("11:00");
    expect(p.endTime).toBe("12:00");
    expect(p.capacity).toBe(6);
  });

  it("never starts before the preset's earliest time", () => {
    const p = quickMeetupPrefill(dinner, at(9, 0));
    expect(p.startTime).toBe("18:30");
    expect(p.endTime).toBe("20:30");
  });

  it("rolls late-night requests to tomorrow morning", () => {
    const p = quickMeetupPrefill(coffee, at(22, 30));
    expect(p.date).toBe("2026-11-18");
    expect(p.startTime).toBe("09:00");
  });

  it("keeps the end time inside the same day", () => {
    const p = quickMeetupPrefill(dinner, at(19, 50));
    expect(p.date).toBe("2026-11-17");
    expect(p.startTime).toBe("21:00");
    expect(p.endTime).toBe("23:00");
  });

  it("moves a too-late dinner to tomorrow at the preset time", () => {
    const p = quickMeetupPrefill(dinner, at(20, 50));
    expect(p.date).toBe("2026-11-18");
    expect(p.startTime).toBe("18:30");
    expect(p.endTime).toBe("20:30");
  });
});
