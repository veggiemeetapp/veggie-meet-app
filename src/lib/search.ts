import { supabase } from "@/integrations/supabase/client";

/* ============================================================
 * WO-036 — canonical Search contracts.
 * Viewer identity is derived server-side from auth.uid().
 * Never pass profile ids from the client.
 * ============================================================ */

export type EntityType = "veggie" | "meetup" | "place";

export interface VeggieResult {
  entity_type: "veggie";
  entity_id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  city_name: string | null;
  city_id: string | null;
  is_active_host: boolean;
  dietary_identity: string | null;
  interests: string[];
  shared_interests_label: string | null;

  shared_meetup_title: string | null;
  relationship: "none" | "pending" | "connected" | "verified";
  friendship_id: string | null;
  requester_id: string | null;
  reason_code: string;
  reason_label: string | null;
  cursor: string;
}

export interface MeetupResult {
  entity_type: "meetup";
  entity_id: string;
  title: string;
  description: string;
  category: string;
  /** WO-126A — canonical Primary interest id. */
  primary_interest_id: string | null;
  additional_interest_ids?: string[] | null;
  cover_image_url: string | null;
  date: string;
  start_time: string;
  end_time: string | null;
  timezone: string | null;
  capacity: number;
  attendee_count: number;
  city_id: string | null;
  city_name: string | null;
  neighborhood: string | null;
  location_name: string | null;
  address: string | null;
  host_id: string;
  host_name: string | null;
  host_avatar: string | null;
  is_attending: boolean;
  is_host: boolean;
  is_full: boolean;
  reason_code: string;
  reason_label: string | null;
  cursor: string;
}

export interface PlaceResult {
  entity_type: "place";
  entity_id: string;
  name: string;
  category: string;
  address: string | null;
  cover_image_url: string | null;
  city_id: string | null;
  city_name: string | null;
  neighborhood: string | null;
  // WO-061A: exact coordinates are never returned to clients.
  upcoming_meetups_count: number;
  reason_code: string;
  reason_label: string | null;
  cursor: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface AllResults {
  veggies: VeggieResult[];
  meetups: MeetupResult[];
  places: PlaceResult[];
}

export interface VeggieFilters {
  interests?: string[];
  relationship?: Array<"none" | "pending" | "connected" | "verified">;
}
export interface MeetupFilters {
  categories?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  availability?: "any" | "available" | "full";
  attendance?: "any" | "mine" | "hosting";
  includePast?: boolean;
}
export interface PlaceFilters {
  categories?: string[];
  neighborhood?: string | null;
}

type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>).call(supabase, name, args);

export async function searchAll(
  query: string,
  cityId: string | null,
  includeAllCities: boolean,
  limitPerType = 3,
): Promise<AllResults> {
  const { data, error } = await rpc<AllResults>("search_all", {
    _query: query,
    _city_id: cityId,
    _include_all_cities: includeAllCities,
    _limit_per_type: limitPerType,
  });
  if (error) throw new Error(error.message);
  return data ?? { veggies: [], meetups: [], places: [] };
}

export async function searchVeggies(
  query: string,
  cityId: string | null,
  includeAllCities: boolean,
  filters: VeggieFilters,
  cursor: string | null,
  limit = 20,
): Promise<Page<VeggieResult>> {
  const { data, error } = await rpc<Page<VeggieResult>>("search_veggies", {
    _query: query,
    _city_id: cityId,
    _include_all_cities: includeAllCities,
    _interests: filters.interests?.length ? filters.interests : null,
    _relationship: filters.relationship?.length ? filters.relationship : null,
    _limit: limit,
    _cursor: cursor,
  });
  if (error) throw new Error(error.message);
  // WO-075: eligibility (deleted / onboarding-incomplete / discovery_visible /
  // blocked in either direction / self) is enforced entirely inside
  // `search_veggies` via `discovery_eligible_profile_ids`. No client-side
  // post-filtering — it would break pagination and leak candidate existence.
  return data ?? { items: [], next_cursor: null };
}


export async function searchMeetups(
  query: string,
  cityId: string | null,
  includeAllCities: boolean,
  filters: MeetupFilters,
  cursor: string | null,
  limit = 20,
): Promise<Page<MeetupResult>> {
  const { data, error } = await rpc<Page<MeetupResult>>("search_meetups", {
    _query: query,
    _city_id: cityId,
    _include_all_cities: includeAllCities,
    _categories: filters.categories?.length ? filters.categories : null,
    _date_from: filters.dateFrom ?? null,
    _date_to: filters.dateTo ?? null,
    _availability: filters.availability ?? null,
    _attendance: filters.attendance ?? null,
    _include_past: filters.includePast ?? false,
    _limit: limit,
    _cursor: cursor,
  });
  if (error) throw new Error(error.message);
  return data ?? { items: [], next_cursor: null };
}

export async function searchPlaces(
  query: string,
  cityId: string | null,
  includeAllCities: boolean,
  filters: PlaceFilters,
  cursor: string | null,
  limit = 20,
): Promise<Page<PlaceResult>> {
  const { data, error } = await rpc<Page<PlaceResult>>("search_community_places", {
    _query: query,
    _city_id: cityId,
    _include_all_cities: includeAllCities,
    _categories: filters.categories?.length ? filters.categories : null,
    _neighborhood: filters.neighborhood ?? null,
    _limit: limit,
    _cursor: cursor,
  });
  if (error) throw new Error(error.message);
  return data ?? { items: [], next_cursor: null };
}
