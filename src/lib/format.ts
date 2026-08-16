import { todayISO } from "@/lib/todayDate";

export function isToday(dateISO: string): boolean {
  return dateISO === todayISO();
}

export function formatMeetupDate(dateISO: string): string {
  if (isToday(dateISO)) return "Today";
  const d = new Date(dateISO + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${mStr.padStart(2, "0")} ${period}`;
}

/**
 * WO-112 — normalise any accepted time shape ("HH:MM", "HH:MM:SS", null) to
 * "HH:MM", or null when there is no usable value.
 */
export function normalizeClockTime(t?: string | null): string | null {
  if (!t) return null;
  const trimmed = t.trim();
  if (!/^\d{1,2}:\d{2}/.test(trimmed)) return null;
  const [h, m] = trimmed.split(":");
  return `${h.padStart(2, "0")}:${m.slice(0, 2)}`;
}

/**
 * WO-112 — the single canonical Meetup time formatter.
 * End time is optional: NULL/blank means "no specified ending time", and the
 * range collapses to the start time alone (never "6:30 PM – undefined").
 * The date is never repeated here — surfaces render it separately.
 */
export function formatMeetupTimeRange(start: string, end?: string | null): string {
  const s = normalizeClockTime(start);
  if (!s) return "";
  const e = normalizeClockTime(end);
  if (!e || e === s) return formatTime12h(s);
  return `${formatTime12h(s)} – ${formatTime12h(e)}`;
}

/** @deprecated use formatMeetupTimeRange — kept as a null-safe alias. */
export function formatTimeRange(start: string, end?: string | null): string {
  return formatMeetupTimeRange(start, end);
}

/** Returns null when there is no end time, so callers can omit duration. */
export function formatDuration(start: string, end?: string | null): string | null {
  const s = normalizeClockTime(start);
  const e = normalizeClockTime(end);
  if (!s || !e) return null;
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}


export function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
