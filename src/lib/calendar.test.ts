import { describe, it, expect } from "vitest";
import {
  buildGoogleCalendarUrl,
  CALENDAR_FALLBACK_DURATION_MINUTES,
  GOOGLE_CALENDAR_BASE,
} from "@/lib/calendar";
import type { Meetup } from "@/types";

/** WO-117 — Google Calendar event-template export. */
const base: Meetup = {
  id: "c832d513-0000-4000-8000-000000000001",
  title: "Vegan Sunday Brunch",
  description: "Bring a friend.",
  category: "other",
  hostId: "h1",
  communityPlaceId: "p1",
  coverImageUrl: "",
  date: "2026-08-16",
  startTime: "18:30",
  endTime: "20:00",
  attendeeIds: [],
  capacity: 8,
  status: "upcoming",
  chatId: "",
  location: {
    cityId: null,
    cityName: "Hồ Chí Minh City",
    countryCode: "VN",
    timezone: "Asia/Ho_Chi_Minh",
    neighborhood: null,
    locationName: "BÀ XÃ Vegan Restaurant — Pasteur",
    address: "202 Pasteur, District 1",
    latitude: null,
    longitude: null,
    locationSource: "community_place",
    isInferred: false,
  },
};

function parse(m: Meetup) {
  const url = buildGoogleCalendarUrl(m)!;
  expect(url.startsWith(`${GOOGLE_CALENDAR_BASE}?`)).toBe(true);
  return new URL(url).searchParams;
}

describe("buildGoogleCalendarUrl", () => {
  it("includes every required field", () => {
    const p = parse(base);
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("text")).toBe("Vegan Sunday Brunch");
    expect(p.get("dates")).toBe("20260816T183000/20260816T200000");
    expect(p.get("location")).toBe(
      "BÀ XÃ Vegan Restaurant — Pasteur, 202 Pasteur, District 1",
    );
    expect(p.get("details")).toContain("Bring a friend.");
    expect(p.get("details")).toContain(
      `https://veggiemeet.app/meetup/${base.id}`,
    );
  });

  it("respects an explicit end time", () => {
    expect(parse({ ...base, endTime: "20:00:00" }).get("dates")).toBe(
      "20260816T183000/20260816T200000",
    );
  });

  it("falls back to a one-hour window when end_time is NULL", () => {
    expect(CALENDAR_FALLBACK_DURATION_MINUTES).toBe(60);
    const m = { ...base, endTime: null };
    expect(parse(m).get("dates")).toBe("20260816T183000/20260816T193000");
    expect(m.endTime).toBeNull(); // never mutates stored data
  });

  it("rolls the fallback across midnight", () => {
    expect(parse({ ...base, startTime: "23:30", endTime: null }).get("dates")).toBe(
      "20260816T233000/20260817T003000",
    );
  });

  it("preserves the Meetup timezone regardless of the client timezone", () => {
    const p = parse(base);
    expect(p.get("ctz")).toBe("Asia/Ho_Chi_Minh");
    expect(p.get("dates")).toContain("T183000");
  });

  it("omits ctz when the Meetup has no timezone on file", () => {
    const p = parse({ ...base, location: { ...base.location!, timezone: null } });
    expect(p.get("ctz")).toBeNull();
  });

  it("encodes Vietnamese text, special characters and newlines", () => {
    const url = buildGoogleCalendarUrl({
      ...base,
      title: 'Coffee & Friends: "Sunday"',
      description: "Say hi — it's fun\nSee you there 🌱",
    })!;
    expect(url).not.toContain(" ");
    expect(url).not.toContain('"');
    const p = new URL(url).searchParams;
    expect(p.get("text")).toBe('Coffee & Friends: "Sunday"');
    expect(p.get("details")).toContain("Say hi — it's fun\nSee you there 🌱");
  });

  it("uses the canonical production URL, never lovable.app", () => {
    const url = buildGoogleCalendarUrl(base)!;
    expect(url).not.toContain("lovable.app");
    expect(url).not.toContain("localhost");
    expect(new URL(url).searchParams.get("details")).toContain(
      "https://veggiemeet.app/meetup/",
    );
  });

  it("falls back to a canonical description when the Meetup has none", () => {
    const p = parse({ ...base, description: "   " });
    expect(p.get("details")).toBe(
      `Join this Meetup on VeggieMeet:\nhttps://veggiemeet.app/meetup/${base.id}`,
    );
  });

  it("uses the custom location when there is no place snapshot", () => {
    const p = parse({
      ...base,
      location: undefined,
      customLocation: { name: "Riverside Park", address: "Thao Dien" },
    });
    expect(p.get("location")).toBe("Riverside Park, Thao Dien");
  });

  it("returns null for unusable Meetup time data", () => {
    expect(buildGoogleCalendarUrl({ ...base, date: "soon" })).toBeNull();
    expect(buildGoogleCalendarUrl({ ...base, startTime: "later" })).toBeNull();
  });
});
