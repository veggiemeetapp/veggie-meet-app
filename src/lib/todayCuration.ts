import { supabase } from "@/integrations/supabase/client";

/**
 * WO-106 — owner Today curation for Community Places.
 *
 * Editorial state lives server-side in `today_place_curation` and is only ever
 * read/written through owner-only SECURITY DEFINER RPCs. Nothing here is
 * member-facing: Today cards stay ordinary recommendations.
 */

export type TodayPlaceState = "normal" | "featured" | "hidden";

export interface CurationPlace {
  place_id: string;
  name: string;
  category: string;
  is_active: boolean;
  maintenance_status: string;
  verification_status: string;
  state: TodayPlaceState;
  featured_rank: number | null;
}

export interface TodayCuration {
  city_id: string;
  /** How many Community Places Today can display (server-canonical). */
  slot_limit: number;
  places: CurationPlace[];
}

type RpcFn = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;

// NOTE: destructuring supabase.rpc drops its `this` binding — always .call().
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      n: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: T | null; error: { message: string } | null }>
  ).call(supabase, name, args);

/** Owner-safe message for a curation mutation failure. Never raw SQL. */
export function mapCurationError(message?: string | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("not authorized")) return "This area is limited to the VeggieMeet owner.";
  if (m.includes("up to 3") || m.includes("remove one featured"))
    return "Today shows up to 3 Community Places. Remove one featured place first.";
  if (m.includes("no longer matches"))
    return "The featured list changed. We refreshed it — try again.";
  if (m.includes("not linked to a city"))
    return "This place isn’t linked to a city yet, so it can’t be curated.";
  if (m.includes("unsupported today state")) return "That Today state isn’t supported.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Couldn’t reach VeggieMeet. Check your connection and try again.";
  return "Couldn’t save that change. Please try again.";
}

export async function fetchTodayCuration(cityId: string): Promise<TodayCuration> {
  const { data, error } = await rpc<TodayCuration>("get_today_place_curation", {
    _city_id: cityId,
  });
  if (error) throw new Error(mapCurationError(error.message));
  return data ?? { city_id: cityId, slot_limit: 3, places: [] };
}

export async function setTodayPlaceState(
  placeId: string,
  state: TodayPlaceState,
): Promise<void> {
  const { error } = await rpc("set_today_place_state", {
    _place_id: placeId,
    _state: state,
  });
  if (error) throw new Error(mapCurationError(error.message));
}

export async function reorderTodayFeatured(
  cityId: string,
  orderedPlaceIds: string[],
): Promise<void> {
  const { error } = await rpc("reorder_today_featured_places", {
    _city_id: cityId,
    _ordered_place_ids: orderedPlaceIds,
  });
  if (error) throw new Error(mapCurationError(error.message));
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Featured (by owner rank), automatic and hidden buckets. */
export function splitCuration(places: CurationPlace[]): {
  featured: CurationPlace[];
  normal: CurationPlace[];
  hidden: CurationPlace[];
} {
  const featured = places
    .filter((p) => p.state === "featured")
    .sort(
      (a, b) =>
        (a.featured_rank ?? Number.MAX_SAFE_INTEGER) -
          (b.featured_rank ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
    );
  const byName = (a: CurationPlace, b: CurationPlace) => a.name.localeCompare(b.name);
  return {
    featured,
    normal: places.filter((p) => p.state === "normal").sort(byName),
    hidden: places.filter((p) => p.state === "hidden").sort(byName),
  };
}

/** Swap one featured place with its neighbour. Returns the new id order. */
export function moveFeatured(
  ids: string[],
  index: number,
  direction: "up" | "down",
): string[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Does this place currently satisfy the hard Today eligibility rules the owner
 * cannot override? Owner ranking never beats integrity: an inactive or
 * non-operational place stays out of Today even while featured.
 */
export function isTodayEligible(p: CurationPlace): boolean {
  return p.is_active && p.maintenance_status !== "permanently_closed";
}

/** Owner-facing operational line. Textual — never colour-only. */
export function operationalLabel(p: CurationPlace): string {
  if (!p.is_active) return "Hidden from discovery";
  switch (p.maintenance_status) {
    case "permanently_closed":
      return "Permanently closed";
    case "temporarily_closed":
      return "Temporarily closed";
    case "needs_review":
      return "Needs review";
    default:
      return "Operational";
  }
}
