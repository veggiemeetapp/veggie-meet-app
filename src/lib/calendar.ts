import { PRODUCTION_ORIGIN, meetupShareUrl } from "@/lib/share";
import { normalizeClockTime } from "@/lib/format";
import type { Meetup } from "@/types";

/**
 * WO-117 — one-time "Add to Google Calendar" handoff.
 *
 * Stateless by design: VeggieMeet never asks for Google Calendar OAuth scopes,
 * never stores tokens, and never writes to a member's calendar. We only build a
 * Google Calendar *event template* URL from public Meetup data and open it; the
 * member completes (or abandons) the save inside Google.
 *
 * Consequences, documented as beta limitations:
 * - Leaving a Meetup cannot remove an already-saved Google event.
 * - Host edits to date/time/location do not propagate to a saved Google event.
 * This is a one-time export, never a "calendar sync".
 */
export const GOOGLE_CALENDAR_BASE =
  "https://calendar.google.com/calendar/render";

/**
 * Export-only fallback for open-ended Meetups (end_time IS NULL — WO-112).
 * Google requires a finite event window; VeggieMeet still treats the Meetup as
 * open-ended and this never mutates stored data.
 */
export const CALENDAR_FALLBACK_DURATION_MINUTES = 60;

/** Google's basic-format local date-time: YYYYMMDDTHHMMSS (no offset). */
function googleStamp(dateISO: string, hhmm: string): string {
  return `${dateISO.replace(/-/g, "")}T${hhmm.replace(":", "")}00`;
}

function addMinutes(dateISO: string, hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  // Anchored in UTC purely as calendar arithmetic — no timezone conversion is
  // performed here, so the wall-clock time stays the Meetup's local time.
  const base = Date.UTC(
    Number(dateISO.slice(0, 4)),
    Number(dateISO.slice(5, 7)) - 1,
    Number(dateISO.slice(8, 10)),
    h,
    m,
  );
  const d = new Date(base + minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

export function meetupCalendarLocation(meetup: Meetup): string | null {
  const name = meetup.location?.locationName ?? meetup.customLocation?.name ?? null;
  const address = meetup.location?.address ?? meetup.customLocation?.address ?? null;
  const city = meetup.location?.cityName ?? null;
  const parts = [name, address ?? city].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

export function meetupCalendarDescription(meetup: Meetup): string {
  const url = meetupShareUrl(meetup.id);
  const body = meetup.description?.trim();
  return body
    ? `${body}\n\nView Meetup on VeggieMeet:\n${url}`
    : `Join this Meetup on VeggieMeet:\n${url}`;
}

/**
 * Builds the Google Calendar event-template URL for a Meetup, or null when the
 * Meetup lacks the trusted date/time needed for a valid event.
 */
export function buildGoogleCalendarUrl(meetup: Meetup): string | null {
  if (!meetup?.id || !meetup.date || !/^\d{4}-\d{2}-\d{2}$/.test(meetup.date)) {
    return null;
  }
  const start = normalizeClockTime(meetup.startTime);
  if (!start) return null;

  const end = normalizeClockTime(meetup.endTime);
  let endDate = meetup.date;
  let endTime = end;
  // Explicit end (WO-112) wins. NULL / non-advancing end falls back to the
  // documented export-only duration.
  if (!endTime || endTime <= start) {
    const shifted = addMinutes(meetup.date, start, CALENDAR_FALLBACK_DURATION_MINUTES);
    endDate = shifted.date;
    endTime = shifted.time;
  }

  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", meetup.title?.trim() || "VeggieMeet Meetup");
  params.set(
    "dates",
    `${googleStamp(meetup.date, start)}/${googleStamp(endDate, endTime)}`,
  );
  params.set("details", meetupCalendarDescription(meetup));
  const location = meetupCalendarLocation(meetup);
  if (location) params.set("location", location);
  // Canonical timezone model: the Meetup's location snapshot timezone, so the
  // intended local time is preserved even when the member is travelling. When
  // no timezone is on file we omit ctz and let Google interpret locally.
  const tz = meetup.location?.timezone;
  if (tz) params.set("ctz", tz);

  return `${GOOGLE_CALENDAR_BASE}?${params.toString()}`;
}

export { PRODUCTION_ORIGIN };
