/**
 * WO-124 — shared interest taxonomy helpers.
 *
 * The taxonomy itself lives in one place only: `public.interest_catalogue`.
 * Nothing here hardcodes the list of interests — these helpers just group,
 * filter and bound what the server returns, so member profiles and Meetup
 * tagging can never drift apart or offer a value the server would reject.
 */

import type { InterestOption } from "@/lib/onboarding";

/** Onboarding keeps the flow short. */
export const ONBOARDING_MIN_INTERESTS = 3;
export const ONBOARDING_MAX_INTERESTS = 8;

/**
 * Profile editing: established members may keep as few as 0 interests (we only
 * recommend 3+ for good recommendations) and up to 20. The server enforces the
 * same ceiling; the 3-interest floor applies to onboarding only.
 */
export const PROFILE_MIN_INTERESTS = 0;
export const PROFILE_RECOMMENDED_INTERESTS = 3;
export const PROFILE_MAX_INTERESTS = 20;

/** Meetup tagging: exactly one primary, up to two additional. */
export const MEETUP_MAX_ADDITIONAL_INTERESTS = 2;

/**
 * WO-125 — normalise a Meetup's stored tags for display only.
 *
 * Drops null/blank/non-string values, removes duplicates, never repeats the
 * primary among the additional tags, and bounds additional tags to two. Storage
 * and server validation are untouched; this only makes malformed historical rows
 * degrade safely on read.
 */
export function resolveMeetupTagIds(
  primaryInterestId?: string | null,
  additionalInterestIds?: string[] | null,
): { primaryId: string | null; additionalIds: string[] } {
  const clean = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const primaryId = clean(primaryInterestId);
  const seen = new Set<string>(primaryId ? [primaryId] : []);
  const additionalIds: string[] = [];
  for (const raw of Array.isArray(additionalInterestIds) ? additionalInterestIds : []) {
    const id = clean(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    additionalIds.push(id);
    if (additionalIds.length >= MEETUP_MAX_ADDITIONAL_INTERESTS) break;
  }
  return { primaryId, additionalIds };
}

export interface InterestGroup {
  key: string;
  label: string;
  options: InterestOption[];
}

interface GroupedRow extends InterestOption {
  group_key?: string | null;
  group_label?: string | null;
  group_sort?: number | null;
}

/** Group catalogue rows by their server-defined group, preserving server order. */
export function groupInterests(rows: InterestOption[]): InterestGroup[] {
  const groups = new Map<string, InterestGroup & { sort: number }>();
  for (const row of rows as GroupedRow[]) {
    const key = row.group_key ?? row.category ?? "other";
    const label = row.group_label ?? "Interests";
    const sort = row.group_sort ?? 0;
    if (!groups.has(key)) groups.set(key, { key, label, sort, options: [] });
    groups.get(key)!.options.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ key, label, options }) => ({ key, label, options }));
}

/** Case-insensitive label/id search across the catalogue. */
export function filterInterests(rows: InterestOption[], query: string): InterestOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
  );
}

export function labelForId(rows: InterestOption[], id: string | null): string | null {
  if (!id) return null;
  return rows.find((r) => r.id === id)?.label ?? null;
}

export function idForLabel(rows: InterestOption[], label: string): string | null {
  const l = label.trim().toLowerCase();
  return rows.find((r) => r.label.toLowerCase() === l)?.id ?? null;
}

/**
 * Lightweight, purely client-side suggestion: which catalogue interests are
 * hinted at by the Meetup title/description. Suggestions are never applied
 * automatically — the host always confirms.
 */
export function suggestInterestIds(
  rows: InterestOption[],
  text: string,
  limit = 3,
): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!words.length) return [];
  const bag = new Set(words);
  const scored = rows
    .map((r) => {
      const tokens = r.label.toLowerCase().match(/[a-z]+/g) ?? [];
      const hits = tokens.filter((t) => bag.has(t) || bag.has(`${t}s`)).length;
      return { id: r.id, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Mirror of `public.meetup_interest_score`: primary-tag overlap always
 * outranks additional-tag overlap. Kept here for tests and UI explanations —
 * ranking itself is computed server-side.
 */
export function meetupInterestScore(
  primaryId: string | null,
  additionalIds: string[],
  viewerInterestIds: string[],
): number {
  const viewer = new Set(viewerInterestIds);
  const primary = primaryId && viewer.has(primaryId) ? 40 : 0;
  const extra =
    Math.min(
      MEETUP_MAX_ADDITIONAL_INTERESTS,
      additionalIds.filter((id) => viewer.has(id)).length,
    ) * 12;
  return primary + extra;
}

/**
 * WO-126 — documentation mirror of `public.legacy_meetup_category_for_interest`.
 *
 * The legacy `meetups.category` enum column is retained as an invisible
 * compatibility detail and is derived SERVER-SIDE from the Meetup's Primary
 * canonical category. This mirror exists for tests and documentation only —
 * the client never sends a category value. Mapping is by stable interest id,
 * never by display label. Ids without an accurate legacy equivalent resolve to
 * the enum's residual member `other`, which is never shown to hosts or members.
 */
export const LEGACY_MEETUP_CATEGORY_BY_INTEREST_ID: Record<string, string> = {
  coffee: "coffee",
  cooking: "cooking",
  dining_out: "dinner",
  picnics: "picnic",
  hiking: "walk",
  walking: "walk",
  workshops_learning: "workshop",
};

export function legacyMeetupCategoryForInterest(id: string | null): string {
  if (!id) return "other";
  return LEGACY_MEETUP_CATEGORY_BY_INTEREST_ID[id] ?? "other";
}
