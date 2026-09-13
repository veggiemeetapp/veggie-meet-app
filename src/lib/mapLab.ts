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
}

export interface MapLabMeetup {
  id: string;
  title: string;
  date: string;
  start_time: string;
  primary_interest_id: string | null;
  location_name: string | null;
  location_source: string | null;
  latitude: number;
  longitude: number;
  coordinate_origin: "meetup" | "inherited_place" | "missing";
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
