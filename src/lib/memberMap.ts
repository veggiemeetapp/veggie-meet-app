import { supabase } from "@/integrations/supabase/client";

/**
 * WO-154 — data access for the PRIVATE, GATED member-facing Map (`/map`).
 *
 * Deliberate differences from the WO-153 owner prototype:
 *  - PRODUCTION DATA ONLY. There is no fixture path in this module at all.
 *  - No owner-only SECURITY DEFINER read. Every query below runs as the signed-in
 *    member through ordinary table reads, so existing RLS decides visibility and
 *    the Map can never expose more than the Community list already does.
 *  - Member privacy is unchanged: nothing here reads member coordinates,
 *    distance, GPS or presence. Veggies remain city-level only and are fetched
 *    by the existing city-scoped people query.
 *
 * Access itself is authorised server-side by `has_map_access()` (owner or an
 * explicit `map_access_grants` row). The client gate is presentation only.
 */

export interface MemberMapPlace {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  neighborhood: string | null;
  veggie_classification: string | null;
  latitude: number;
  longitude: number;
}

export interface MemberMapMeetup {
  id: string;
  title: string;
  date: string;
  start_time: string;
  primary_interest_id: string | null;
  cover_image_url: string | null;
  location_name: string | null;
  latitude: number;
  longitude: number;
}

export interface MemberMapData {
  places: MemberMapPlace[];
  meetups: MemberMapMeetup[];
}

/** Server-authorised gate check. Returns false for every ungranted member. */
export async function fetchMapAccess(): Promise<boolean> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      n: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "has_map_access");
  if (error) return false;
  return data === true;
}

/**
 * Published, operational Community Places with coordinates, plus upcoming
 * non-cancelled Meetups, for the selected city.
 *
 * Served by `get_member_map_data`, which applies the SAME eligibility rule the
 * Community discovery list already uses and is itself gated by
 * `has_map_access()`. The Data API deliberately does not expose
 * `public.community_places` to signed-in members, so the Map reads through this
 * RPC rather than widening any table grant or RLS policy.
 */
export async function fetchMemberMapData(cityId: string): Promise<MemberMapData> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      n: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "get_member_map_data", { _city_id: cityId });
  if (error || !data) return { places: [], meetups: [] };

  const payload = data as { places?: unknown; meetups?: unknown };
  const places = (Array.isArray(payload.places) ? payload.places : []) as MemberMapPlace[];
  const meetups = (Array.isArray(payload.meetups) ? payload.meetups : []) as MemberMapMeetup[];
  return {
    places: places.filter((p) => p.latitude != null && p.longitude != null),
    meetups: meetups.filter((m) => m.latitude != null && m.longitude != null),
  };
}
