CREATE OR REPLACE FUNCTION public.get_owner_map_lab_data(_city_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  city_row record;
  places jsonb;
  meetups jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.name, c.latitude, c.longitude, c.timezone
    INTO city_row
    FROM public.cities c
   WHERE (_city_id IS NOT NULL AND c.id = _city_id)
      OR (_city_id IS NULL AND c.id = public.resolve_viewer_city_id(me))
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'category', p.category::text,
           'address', p.address,
           'neighborhood', p.neighborhood,
           'veggie_classification', p.veggie_classification,
           'latitude', p.latitude,
           'longitude', p.longitude
         ) ORDER BY p.name), '[]'::jsonb)
    INTO places
    FROM public.community_places p
   WHERE p.is_active IS TRUE
     AND p.verification_status = 'verified'
     AND COALESCE(p.maintenance_status, 'operational') = 'operational'
     AND (p.business_status IS NULL OR p.business_status = 'OPERATIONAL')
     AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
     AND (city_row.id IS NULL OR p.city_id = city_row.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'title', m.title,
           'date', m.date,
           'start_time', m.start_time,
           'primary_interest_id', m.primary_interest_id,
           'location_name', COALESCE(m.location_name, m.custom_location_name),
           'location_source', m.location_source::text,
           'latitude', COALESCE(m.latitude, cp.latitude),
           'longitude', COALESCE(m.longitude, cp.longitude),
           'coordinate_origin', CASE
             WHEN m.latitude IS NOT NULL THEN 'meetup'
             WHEN cp.latitude IS NOT NULL THEN 'inherited_place'
             ELSE 'missing' END
         ) ORDER BY m.date DESC), '[]'::jsonb)
    INTO meetups
    FROM public.meetups m
    LEFT JOIN public.community_places cp ON cp.id = m.community_place_id
   WHERE m.status <> 'cancelled'::meetup_status
     AND m.cancelled_at IS NULL
     AND COALESCE(m.latitude, cp.latitude) IS NOT NULL
     AND (city_row.id IS NULL OR m.city_id = city_row.id);

  RETURN jsonb_build_object(
    'city', CASE WHEN city_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', city_row.id, 'name', city_row.name,
      'latitude', city_row.latitude, 'longitude', city_row.longitude,
      'timezone', city_row.timezone) END,
    'places', places,
    'meetups', meetups
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_owner_map_lab_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_owner_map_lab_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_map_lab_data(uuid) TO service_role;