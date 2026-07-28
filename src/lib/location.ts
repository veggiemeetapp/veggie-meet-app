import { supabase } from "@/integrations/supabase/client";

export interface City {
  id: string;
  name: string;
  country_code: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
}

export interface LocationContext {
  home_city: City | null;
  selected_city: City | null;
  timezone: string | null;
  distance_available: boolean;
}

export interface UpdateMeetupLocationResult {
  meetup_id: string;
  change_id: string;
  meaningful_change: boolean;
  coord_shift_m: number;
  recipients_count: number;
  notifications_inserted: number;
}

// Wrappers use rpc-name casts because Supabase types are regenerated
// after the migration is approved; this keeps compile-time green.
// NOTE: destructuring supabase.rpc drops its `this` binding and silently no-ops
// the network call. Always invoke via .call(supabase, ...).
type RpcFn = <T>(name: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
const rpc: RpcFn = <T,>(name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>).call(supabase, name, args);

export async function fetchActiveCities(): Promise<City[]> {
  const { data, error } = await rpc<City[]>("get_active_cities");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMyLocationContext(): Promise<LocationContext> {
  const { data, error } = await rpc<LocationContext>("get_my_location_context");
  if (error) throw new Error(error.message);
  return (
    data ?? {
      home_city: null,
      selected_city: null,
      timezone: null,
      distance_available: false,
    }
  );
}

export async function setSelectedCity(cityId: string | null): Promise<void> {
  const { error } = await rpc<null>("set_selected_city", { _city_id: cityId });
  if (error) throw new Error(error.message);
}

export async function setHomeCity(cityId: string): Promise<void> {
  const { error } = await rpc<null>("set_home_city", { _city_id: cityId });
  if (error) throw new Error(error.message);
}

export interface UpdateMeetupLocationInput {
  meetupId: string;
  cityId: string;
  communityPlaceId: string | null;
  locationName: string;
  address: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  locationSource: "community_place" | "custom_location" | "unknown";
}

export async function updateMeetupLocation(
  input: UpdateMeetupLocationInput,
): Promise<UpdateMeetupLocationResult> {
  const { data, error } = await rpc<UpdateMeetupLocationResult>("update_meetup_location", {
    _meetup_id: input.meetupId,
    _city_id: input.cityId,
    _community_place_id: input.communityPlaceId,
    _location_name: input.locationName,
    _address: input.address,
    _neighborhood: input.neighborhood,
    _latitude: input.latitude,
    _longitude: input.longitude,
    _timezone: input.timezone,
    _location_source: input.locationSource,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Location update returned no data");
  return data;
}
