/**
 * Spontaneous ("quick") meetups — one tap from Community pre-fills the Host
 * form with a sensible title, interest, time window and group size, so a
 * "coffee in an hour" takes three taps instead of a full form. The host still
 * picks the place and can edit anything before publishing; nothing is created
 * until they do.
 */

export type QuickMeetupPreset = "coffee" | "lunch" | "dinner" | "walk";

export interface QuickMeetupDefinition {
  key: QuickMeetupPreset;
  /** Chip label on Community. */
  label: string;
  emoji: string;
  title: string;
  /** interest_catalogue id; only applied when the catalogue contains it. */
  interestId: string;
  /** Earliest sensible start as HH:MM (24h); the slot is never before "now + lead". */
  earliest: string;
  /** Minutes. */
  duration: number;
  capacity: number;
}

export const QUICK_MEETUP_PRESETS: readonly QuickMeetupDefinition[] = [
  { key: "coffee", label: "Coffee now", emoji: "☕", title: "Quick plant-based coffee", interestId: "coffee", earliest: "07:00", duration: 60, capacity: 6 },
  { key: "lunch", label: "Lunch today", emoji: "🥗", title: "Vegan lunch together", interestId: "vegan_food", earliest: "12:00", duration: 90, capacity: 6 },
  { key: "dinner", label: "Dinner tonight", emoji: "🍜", title: "Vegan dinner tonight", interestId: "vegan_food", earliest: "18:30", duration: 120, capacity: 6 },
  { key: "walk", label: "Walk & talk", emoji: "🚶", title: "Walk & talk", interestId: "hiking", earliest: "07:00", duration: 60, capacity: 6 },
];

export function quickMeetupPreset(key: string | null | undefined): QuickMeetupDefinition | null {
  if (!key) return null;
  return QUICK_MEETUP_PRESETS.find((p) => p.key === key) ?? null;
}

export interface QuickMeetupPrefill {
  title: string;
  interestId: string;
  /** YYYY-MM-DD (local). */
  date: string;
  /** HH:MM (24h). */
  startTime: string;
  endTime: string;
  capacity: number;
}

/** Minutes a spontaneous meetup must give people to get there. */
export const QUICK_MEETUP_LEAD_MINUTES = 45;
/** Starts at or after this hour roll to the next morning. */
const LATEST_START_HOUR = 22;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Pure: given the preset and "now", pick the next half-hour slot that is at
 * least the lead time away and not before the preset's earliest time. If
 * that lands late at night, move to tomorrow at the preset's earliest time.
 */
export function quickMeetupPrefill(preset: QuickMeetupDefinition, now: Date = new Date()): QuickMeetupPrefill {
  const nowMin = now.getHours() * 60 + now.getMinutes() + QUICK_MEETUP_LEAD_MINUTES;
  const nextSlot = Math.ceil(nowMin / 30) * 30;
  let start = Math.max(nextSlot, toMinutes(preset.earliest));
  const date = new Date(now);
  if (start >= LATEST_START_HOUR * 60) {
    date.setDate(date.getDate() + 1);
    start = toMinutes(preset.earliest);
    // Morning presets still need a civilised hour tomorrow.
    if (start < 8 * 60) start = 9 * 60;
  }
  const end = Math.min(start + preset.duration, 23 * 60 + 30);
  return {
    title: preset.title,
    interestId: preset.interestId,
    date: localISO(date),
    startTime: hhmm(start),
    endTime: hhmm(end),
    capacity: preset.capacity,
  };
}
