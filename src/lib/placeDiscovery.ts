/**
 * Owner-only bulk discovery of vegan / vegetarian places through Google Places.
 *
 * The server (`place-verification`, action `discover`) runs ONE text query per
 * call, paginates the Google results, drops closed businesses, results far
 * outside the city and Google Place IDs already known, and writes the rest as
 * `needs_review` candidates with `source = 'google_discovered'`.
 *
 * Nothing discovered is public: every candidate still goes through the normal
 * owner review and `verify_and_publish_place_candidate()` gate, and the vegan
 * classification is never pre-filled from Google (only official evidence may
 * classify a place — Google's type is left as a hint in the notes).
 */

/** Per-country query sets. Local-language terms find far more than English. */
const QUERIES_BY_COUNTRY: Record<string, readonly string[]> = {
  VN: ["quán chay", "nhà hàng chay", "cơm chay", "buffet chay", "vegan restaurant", "vegetarian restaurant"],
  TH: ["ร้านอาหารเจ", "ร้านอาหารมังสวิรัติ", "vegan restaurant", "vegetarian restaurant", "vegan cafe"],
  SG: ["vegan restaurant", "vegetarian restaurant", "vegan cafe", "vegetarian food"],
};

const DEFAULT_QUERIES: readonly string[] = [
  "vegan restaurant",
  "vegetarian restaurant",
  "vegan cafe",
  "plant based restaurant",
];

export function discoveryQueriesFor(countryCode: string | null | undefined): string[] {
  const code = (countryCode ?? "").trim().toUpperCase();
  return [...(QUERIES_BY_COUNTRY[code] ?? DEFAULT_QUERIES)];
}

/** Wire shape returned by the server for one query. */
export interface DiscoveryBatchResult {
  query: string;
  /** Results Google returned across all fetched pages. */
  fetched: number;
  /** New candidates written. */
  inserted: number;
  /** Google Place IDs already present as a candidate or a live place. */
  skipped_existing: number;
  /** Not OPERATIONAL per Google. */
  skipped_closed: number;
  /** Outside the city radius or missing coordinates / identity fields. */
  skipped_far: number;
}

export interface DiscoverySummary {
  queries: number;
  fetched: number;
  inserted: number;
  skipped_existing: number;
  skipped_closed: number;
  skipped_far: number;
}

export function summarizeDiscovery(results: readonly DiscoveryBatchResult[]): DiscoverySummary {
  const sum = (k: keyof Omit<DiscoveryBatchResult, "query">) =>
    results.reduce((n, r) => n + (Number.isFinite(r[k]) ? r[k] : 0), 0);
  return {
    queries: results.length,
    fetched: sum("fetched"),
    inserted: sum("inserted"),
    skipped_existing: sum("skipped_existing"),
    skipped_closed: sum("skipped_closed"),
    skipped_far: sum("skipped_far"),
  };
}

/** Owner-facing one-liner for the toast after a discovery run. */
export function discoverySummaryMessage(s: DiscoverySummary): string {
  if (s.inserted === 0) {
    return s.fetched === 0
      ? "Google returned no places for this city."
      : `No new places: ${s.skipped_existing} already known, ${s.skipped_closed} closed, ${s.skipped_far} outside the city.`;
  }
  return `${s.inserted} new ${s.inserted === 1 ? "candidate" : "candidates"} added to Needs review (${s.skipped_existing} already known, ${s.skipped_closed} closed, ${s.skipped_far} outside the city).`;
}
