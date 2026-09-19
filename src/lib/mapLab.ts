import { supabase } from "@/integrations/supabase/client";

/**
 * WO-152 — read-only data access for the PRIVATE owner map lab prototype.
 *
 * Backed by `get_owner_map_lab_data`, a SECURITY DEFINER function that refuses
 * any caller who is not the VeggieMeet owner. It returns only already-published
 * Community Place coordinates and non-cancelled Meetup coordinates. It never
 * returns member profiles and never returns member location of any kind.
 */

export interface MapLabCity {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

export interface MapLabPlace {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  neighborhood: string | null;
  veggie_classification: string | null;
  latitude: number;
  longitude: number;
  /** WO-153 — true only for DEV/TEST-ONLY prototype fixtures. */
  is_fixture?: boolean;
}

export interface MapLabMeetup {
  id: string;
  title: string;
  date: string;
  start_time: string;
  primary_interest_id: string | null;
  /** WO-155 — owner-only visual fixtures may provide a local review image. */
  cover_image_url?: string | null;
  location_name: string | null;
  location_source: string | null;
  latitude: number;
  longitude: number;
  coordinate_origin: "meetup" | "inherited_place" | "missing";
  /** WO-153 — true only for DEV/TEST-ONLY prototype fixtures. */
  is_fixture?: boolean;
}

export interface MapLabData {
  city: MapLabCity | null;
  places: MapLabPlace[];
  meetups: MapLabMeetup[];
}

export async function fetchMapLabData(cityId: string | null): Promise<MapLabData> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      n: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "get_owner_map_lab_data", { _city_id: cityId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<MapLabData>;
  return { city: d.city ?? null, places: d.places ?? [], meetups: d.meetups ?? [] };
}

/**
 * WO-153 §55 — read-only, best-effort read of the existing Today curation so the
 * prototype can experiment with slightly stronger treatment for featured Places.
 * Never writes and never mutates curation data.
 */
export async function fetchFeaturedPlaceIds(cityId: string | null): Promise<string[]> {
  if (!cityId) return [];
  const { data, error } = await supabase
    .from("today_place_curation")
    .select("community_place_id, state, featured_rank")
    .eq("city_id", cityId);
  if (error || !data) return [];
  return (data as Array<{ community_place_id: string; state: string | null }>)
    .filter((r) => r.state === "featured")
    .map((r) => r.community_place_id);
}

