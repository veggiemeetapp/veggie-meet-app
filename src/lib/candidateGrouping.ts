import type { PlaceCandidate } from "@/lib/placeVerification";

/**
 * WO-128 — Candidate list information architecture.
 *
 * Pure grouping / search / sort helpers for the owner Community Place
 * Candidates workspace. No backend calls, no lifecycle semantics: the
 * candidate rows and their `verification_status` values are untouched.
 */

export type CandidateGroupKey = "draft" | "published" | "rejected";

export const CANDIDATE_GROUP_ORDER: CandidateGroupKey[] = [
  "draft",
  "published",
  "rejected",
];

export const CANDIDATE_GROUP_LABEL: Record<CandidateGroupKey, string> = {
  draft: "Draft",
  published: "Published",
  rejected: "Rejected",
};

export const CANDIDATE_GROUP_EMPTY: Record<CandidateGroupKey, string> = {
  draft: "No draft candidates.",
  published: "No published candidates yet.",
  rejected: "No rejected candidates.",
};

/** Sections open on first entry — Draft is the active operational queue. */
export const CANDIDATE_GROUP_DEFAULT_OPEN: Record<CandidateGroupKey, boolean> = {
  draft: true,
  published: false,
  rejected: false,
};

/**
 * Canonical backend status → UI group.
 *
 * `draft` is the active pre-publication queue and therefore also holds the
 * in-flight lifecycle statuses (`needs_review`, `verified`). Any status we do
 * not recognise falls into the same active queue so a candidate can never be
 * silently hidden from the owner; the card badge still shows its real status.
 */
export function candidateGroupOf(status: string | null | undefined): CandidateGroupKey {
  switch (status) {
    case "published":
      return "published";
    case "rejected":
      return "rejected";
    default:
      return "draft";
  }
}

type Candidate = Pick<
  PlaceCandidate,
  | "id"
  | "display_name"
  | "public_display_name"
  | "public_address"
  | "google_display_name"
  | "google_formatted_address"
  | "google_place_id"
  | "district"
  | "category"
  | "verification_status"
> &
  Partial<{
    updated_at: string | null;
    created_at: string | null;
    published_at: string | null;
    city_id: string | null;
  }>;

/** Case-insensitive haystack: name, address, district, city, category, Place ID. */
export function candidateHaystack(
  c: Candidate,
  cityName?: (id: string | null | undefined) => string | null | undefined,
): string {
  return [
    c.display_name,
    c.public_display_name,
    c.google_display_name,
    c.public_address,
    c.google_formatted_address,
    c.district,
    cityName?.(c.city_id),
    c.category,
    c.google_place_id,
    c.verification_status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function candidateMatches(
  c: Candidate,
  query: string,
  cityName?: (id: string | null | undefined) => string | null | undefined,
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const hay = candidateHaystack(c, cityName);
  return q.split(/\s+/).every((token) => hay.includes(token));
}

const time = (iso: string | null | undefined): number =>
  iso ? new Date(iso).getTime() : 0;

/**
 * Final sort rule (newest first in every group, using existing columns only):
 *   Draft     → updated_at desc
 *   Published → published_at desc, then updated_at desc
 *   Rejected  → updated_at desc
 * Ties fall back to display_name for a stable, predictable order.
 */
export function sortCandidateGroup<T extends Candidate>(
  group: CandidateGroupKey,
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (group === "published") {
      const d = time(b.published_at) - time(a.published_at);
      if (d !== 0) return d;
    }
    const d = time(b.updated_at) - time(a.updated_at);
    if (d !== 0) return d;
    return (a.display_name ?? "").localeCompare(b.display_name ?? "");
  });
}

export interface CandidateGroup<T> {
  key: CandidateGroupKey;
  label: string;
  /** Rows after the active search filter — what the section renders. */
  items: T[];
  /** Search matches in this group. */
  matchCount: number;
  /** Total rows in this group, ignoring search. */
  totalCount: number;
}

/**
 * One pass over the single already-fetched candidate dataset: no per-status
 * request, no N+1.
 */
export function groupCandidates<T extends Candidate>(
  rows: T[] | undefined | null,
  query = "",
  cityName?: (id: string | null | undefined) => string | null | undefined,
): CandidateGroup<T>[] {
  const buckets: Record<CandidateGroupKey, { all: T[]; matched: T[] }> = {
    draft: { all: [], matched: [] },
    published: { all: [], matched: [] },
    rejected: { all: [], matched: [] },
  };

  for (const row of rows ?? []) {
    const bucket = buckets[candidateGroupOf(row.verification_status)];
    bucket.all.push(row);
    if (candidateMatches(row, query, cityName)) bucket.matched.push(row);
  }

  return CANDIDATE_GROUP_ORDER.map((key) => ({
    key,
    label: CANDIDATE_GROUP_LABEL[key],
    items: sortCandidateGroup(key, buckets[key].matched),
    matchCount: buckets[key].matched.length,
    totalCount: buckets[key].all.length,
  }));
}

/** "Draft (11)" when idle, "Draft (2 of 11)" while a search is active. */
export function groupCountLabel(g: CandidateGroup<unknown>, searching: boolean): string {
  return searching ? `${g.matchCount} of ${g.totalCount}` : `${g.totalCount}`;
}
