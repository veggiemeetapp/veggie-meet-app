/**
 * Veggies here + Upcoming trips — client wrappers for the SECURITY DEFINER
 * RPCs in migration 20261117100000_veggies_here_and_trips.sql.
 *
 * Eligibility (deleted / onboarding-incomplete / discovery_visible / blocked
 * either way / self) is enforced entirely server-side; never post-filter
 * results here, it would break pagination and leak existence.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Page, VeggieResult } from "@/lib/search";

type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>).call(supabase, name, args);

export type Presence = "lives_here" | "visiting";

/** Same shape as a search result, plus how the member is present in the city. */
export interface VeggieHereResult extends VeggieResult {
  presence: Presence;
  visit_start: string | null;
  visit_end: string | null;
}

export interface PresencePage extends Page<VeggieHereResult> {
  /** Members matching the filters before pagination. */
  total: number;
}

export const DIETARY_FILTER_VALUES = ["vegan", "vegetarian", "plant_based", "veg_curious"] as const;
export type DietaryFilter = (typeof DIETARY_FILTER_VALUES)[number];

export interface PresenceFilters {
  dietary?: DietaryFilter[];
  hostsOnly?: boolean;
  sharedOnly?: boolean;
  visitingOnly?: boolean;
}

const EMPTY_PAGE: PresencePage = { items: [], next_cursor: null, total: 0 };

function filterArgs(f: PresenceFilters) {
  return {
    _dietary: f.dietary?.length ? f.dietary : null,
    _hosts_only: !!f.hostsOnly,
    _shared_only: !!f.sharedOnly,
    _visiting_only: !!f.visitingOnly,
  };
}

export async function fetchVeggiesHere(
  cityId: string,
  filters: PresenceFilters,
  cursor: string | null,
  limit = 20,
): Promise<PresencePage> {
  const { data, error } = await rpc<PresencePage>("get_veggies_here", {
    _city_id: cityId,
    ...filterArgs(filters),
    _limit: limit,
    _cursor: cursor,
  });
  if (error) throw new Error(error.message);
  return data ?? EMPTY_PAGE;
}

export async function fetchTripOverlaps(
  tripId: string,
  filters: PresenceFilters,
  cursor: string | null,
  limit = 20,
): Promise<PresencePage> {
  const { data, error } = await rpc<PresencePage>("get_trip_overlaps", {
    _trip_id: tripId,
    ...filterArgs(filters),
    _limit: limit,
    _cursor: cursor,
  });
  if (error) throw new Error(error.message);
  return data ?? EMPTY_PAGE;
}

export interface Trip {
  id: string;
  city_id: string;
  city_name: string;
  country_code: string;
  /** ISO date (YYYY-MM-DD). */
  start_date: string;
  end_date: string;
  note: string | null;
  is_current: boolean;
  /** Members who will be in the city at some point during the trip. */
  overlap_count: number;
}

export async function listMyTrips(): Promise<Trip[]> {
  const { data, error } = await rpc<Trip[]>("list_my_trips");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface TripInput {
  cityId: string;
  startDate: string;
  endDate: string;
  note?: string | null;
  tripId?: string | null;
}

/** Create or edit one of my trips. Returns the trip id. */
export async function upsertMyTrip(input: TripInput): Promise<string> {
  const { data, error } = await rpc<string>("upsert_my_trip", {
    _city_id: input.cityId,
    _start_date: input.startDate,
    _end_date: input.endDate,
    _note: input.note?.trim() ? input.note.trim() : null,
    _trip_id: input.tripId ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Trip was not saved.");
  return data;
}

export async function deleteMyTrip(tripId: string): Promise<void> {
  const { error } = await rpc<null>("delete_my_trip", { _trip_id: tripId });
  if (error) throw new Error(error.message);
}

/** "12 – 19 Dec" / "28 Dec – 4 Jan" style range for a trip. */
export function formatTripRange(startISO: string, endISO: string): string {
  const s = new Date(`${startISO}T00:00:00`);
  const e = new Date(`${endISO}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${startISO} – ${endISO}`;
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  const yr = (d: Date) => d.getFullYear();
  const sameYear = yr(s) === yr(e);
  const showYear = yr(e) !== new Date().getFullYear();
  if (s.getMonth() === e.getMonth() && sameYear) {
    return `${day(s)} – ${day(e)} ${mon(e)}${showYear ? ` ${yr(e)}` : ""}`;
  }
  return `${day(s)} ${mon(s)}${sameYear ? "" : ` ${yr(s)}`} – ${day(e)} ${mon(e)}${showYear ? ` ${yr(e)}` : ""}`;
}

/** Local ISO date (YYYY-MM-DD) for <input type="date"> defaults. */
export function todayISODate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
