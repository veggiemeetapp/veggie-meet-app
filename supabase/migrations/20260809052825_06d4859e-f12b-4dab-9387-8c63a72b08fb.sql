CREATE OR REPLACE FUNCTION public.check_in_to_community_place(_place_id uuid, _latitude double precision, _longitude double precision, _accuracy double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  p record;
  dist double precision;
  existing timestamptz;
  is_first boolean;
  new_count int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- WO-078: coordinate sanity. Never trust client-supplied values; reject
  -- NULL, NaN, +/-Infinity and out-of-range latitude/longitude outright so a
  -- non-comparable distance can never fall through the proximity gate.
  IF _latitude IS NULL OR _longitude IS NULL
     OR _latitude <> _latitude OR _longitude <> _longitude
     OR _latitude = 'Infinity'::double precision OR _latitude = '-Infinity'::double precision
     OR _longitude = 'Infinity'::double precision OR _longitude = '-Infinity'::double precision
     OR _latitude < -90 OR _latitude > 90
     OR _longitude < -180 OR _longitude > 180 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'location_unavailable');
  END IF;

  SELECT id, name, latitude, longitude, is_active, verification_status, business_status,
         maintenance_status
    INTO p
    FROM public.community_places
   WHERE id = _place_id;

  IF NOT FOUND
     OR p.is_active IS NOT TRUE
     OR p.verification_status <> 'verified'
     OR COALESCE(p.maintenance_status, 'operational') <> 'operational'
     OR (p.business_status IS NOT NULL AND p.business_status <> 'OPERATIONAL')
     OR p.latitude IS NULL OR p.longitude IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_unavailable');
  END IF;

  -- Accuracy must be a finite, positive number within the WO-046 100 m rule.
  IF _accuracy IS NULL
     OR _accuracy <> _accuracy
     OR _accuracy = 'Infinity'::double precision
     OR _accuracy <= 0
     OR _accuracy > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'accuracy_too_low');
  END IF;

  dist := 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(_latitude - p.latitude) / 2), 2)
      + cos(radians(p.latitude)) * cos(radians(_latitude))
      * power(sin(radians(_longitude - p.longitude) / 2), 2)
    )
  );

  IF dist IS NULL OR dist <> dist OR dist > 150 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outside_radius');
  END IF;

  SELECT visited_at INTO existing
    FROM public.community_place_visits
   WHERE profile_id = me
     AND community_place_id = _place_id
     AND verification_status = 'verified'
     AND visited_at > now() - INTERVAL '12 hours'
   ORDER BY visited_at DESC
   LIMIT 1;

  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'already_checked_in',
      'cooldown_until', existing + INTERVAL '12 hours'
    );
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.community_place_visits
     WHERE profile_id = me AND community_place_id = _place_id
       AND verification_status = 'verified'
  ) INTO is_first;

  INSERT INTO public.community_place_visits (
    profile_id, community_place_id, verification_method, verification_status,
    distance_meters, location_accuracy_meters
  ) VALUES (
    me, _place_id, 'device_location', 'verified',
    round(dist)::int, round(_accuracy)::int
  );

  SELECT count(*)::int INTO new_count FROM public._legit_place_supports(me);

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'success',
    'place_name', p.name,
    'is_first_visit_to_place', is_first,
    'distinct_places_supported', new_count,
    'cooldown_until', now() + INTERVAL '12 hours'
  );
END; $function$;

REVOKE ALL ON FUNCTION public.check_in_to_community_place(uuid,double precision,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_to_community_place(uuid,double precision,double precision,double precision) TO authenticated;