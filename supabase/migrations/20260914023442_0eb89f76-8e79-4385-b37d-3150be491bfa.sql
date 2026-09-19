CREATE OR REPLACE FUNCTION public.get_member_map_data(_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _places jsonb;
  _meetups jsonb;
BEGIN
  IF NOT public.has_map_access() THEN
    RAISE EXCEPTION 'Map access denied';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO _places
  FROM (
    SELECT cp.id, cp.name, cp.category, cp.address, cp.neighborhood,
           cp.veggie_classification, cp.latitude, cp.longitude
    FROM public.community_places cp
    WHERE cp.city_id = _city_id
      AND cp.is_active IS TRUE
      AND cp.verification_status = 'verified'
      AND coalesce(cp.maintenance_status, 'operational') = 'operational'
      AND (cp.business_status IS NULL OR cp.business_status = 'OPERATIONAL')
      AND cp.latitude IS NOT NULL
      AND cp.longitude IS NOT NULL
    LIMIT 500
  ) p;

  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO _meetups
  FROM (
    SELECT mu.id, mu.title, mu.date, mu.start_time, mu.primary_interest_id,
           mu.cover_image_url,
           coalesce(mu.location_name, mu.custom_location_name) AS location_name,
           coalesce(mu.latitude, cp.latitude) AS latitude,
           coalesce(mu.longitude, cp.longitude) AS longitude
    FROM public.meetups mu
    LEFT JOIN public.community_places cp ON cp.id = mu.community_place_id
    WHERE mu.city_id = _city_id
      AND mu.date >= (now() AT TIME ZONE 'utc')::date
      AND mu.status <> 'cancelled'
      AND mu.cancelled_at IS NULL
      AND coalesce(mu.latitude, cp.latitude) IS NOT NULL
      AND coalesce(mu.longitude, cp.longitude) IS NOT NULL
    ORDER BY mu.date, mu.start_time
    LIMIT 300
  ) m;

  RETURN jsonb_build_object('places', _places, 'meetups', _meetups);
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_map_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_map_data(uuid) TO authenticated;