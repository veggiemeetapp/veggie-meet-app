
CREATE OR REPLACE FUNCTION public.update_meetup_location(
  _meetup_id uuid, _city_id uuid, _community_place_id uuid,
  _location_name text, _address text, _neighborhood text,
  _latitude double precision, _longitude double precision,
  _timezone text, _location_source location_source
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  me uuid;
  m RECORD;
  city RECORD;
  meaningful boolean := false;
  coord_shift_m double precision := 0;
  change_id uuid;
  dedup_key text;
  notif_body text;
  notif_meta jsonb;
  att RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN RAISE EXCEPTION 'This Meetup has already been cancelled.'; END IF;
  IF (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now() THEN
    RAISE EXCEPTION 'This Meetup has already ended.';
  END IF;

  IF _city_id IS NULL THEN RAISE EXCEPTION 'City is required'; END IF;
  SELECT * INTO city FROM public.cities WHERE id = _city_id AND is_active;
  IF city IS NULL THEN RAISE EXCEPTION 'City unavailable'; END IF;

  IF (_latitude IS NULL) <> (_longitude IS NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must both be provided or both omitted';
  END IF;
  IF _latitude IS NOT NULL AND (_latitude NOT BETWEEN -90 AND 90 OR _longitude NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;

  IF _timezone IS NULL OR btrim(_timezone) = '' THEN _timezone := city.timezone; END IF;

  IF _latitude IS NOT NULL AND m.latitude IS NOT NULL THEN
    coord_shift_m := 2 * 6371000 * asin(sqrt(
      power(sin(radians((_latitude - m.latitude)/2)), 2) +
      cos(radians(m.latitude)) * cos(radians(_latitude)) *
      power(sin(radians((_longitude - m.longitude)/2)), 2)
    ));
  END IF;

  meaningful := (
    COALESCE(m.city_id::text,'') IS DISTINCT FROM COALESCE(_city_id::text,'') OR
    COALESCE(m.community_place_id::text,'') IS DISTINCT FROM COALESCE(_community_place_id::text,'') OR
    COALESCE(lower(btrim(m.location_name)),'') IS DISTINCT FROM COALESCE(lower(btrim(_location_name)),'') OR
    COALESCE(lower(btrim(m.address)),'') IS DISTINCT FROM COALESCE(lower(btrim(_address)),'') OR
    COALESCE(m.timezone,'') IS DISTINCT FROM COALESCE(_timezone,'') OR
    coord_shift_m > 500
  );

  INSERT INTO public.meetup_location_changes (
    meetup_id, changed_by_profile_id,
    old_city_id, new_city_id,
    old_location_name, new_location_name,
    old_address, new_address,
    old_latitude, old_longitude, new_latitude, new_longitude,
    old_timezone, new_timezone,
    meaningful_change
  ) VALUES (
    _meetup_id, me,
    m.city_id, _city_id,
    m.location_name, _location_name,
    m.address, _address,
    m.latitude, m.longitude, _latitude, _longitude,
    m.timezone, _timezone,
    meaningful
  ) RETURNING id INTO change_id;

  UPDATE public.meetups SET
    city_id = _city_id,
    city_name_snapshot = city.name,
    country_code_snapshot = city.country_code,
    timezone = _timezone,
    neighborhood = _neighborhood,
    location_name = _location_name,
    address = _address,
    latitude = _latitude,
    longitude = _longitude,
    community_place_id = _community_place_id,
    location_source = COALESCE(_location_source, m.location_source),
    location_is_inferred = false,
    location_updated_at = now(),
    updated_at = now()
  WHERE id = _meetup_id;

  IF meaningful THEN
    dedup_key := 'meetup_location_changed:' || _meetup_id::text || ':' || change_id::text;
    notif_body := 'Location updated for ' || COALESCE(m.title,'a Meetup') || '.';
    notif_meta := jsonb_build_object(
      'meetup_id', _meetup_id,
      'change_id', change_id,
      'new_city', city.name,
      'new_location_name', _location_name,
      'new_timezone', _timezone,
      'timezone_changed', (COALESCE(m.timezone,'') IS DISTINCT FROM COALESCE(_timezone,''))
    );

    FOR att IN
      SELECT a.profile_id
        FROM public.attendance a
       WHERE a.meetup_id = _meetup_id
         AND a.profile_id <> me
         AND a.status::text NOT IN ('cancelled','removed')
    LOOP
      PERFORM public._insert_notification(
        att.profile_id, me, 'meetup_updated'::notification_type,
        'meetup', _meetup_id, 'meetup', _meetup_id,
        NULL, notif_body, notif_meta, dedup_key
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'meetup_id', _meetup_id,
    'change_id', change_id,
    'meaningful_change', meaningful,
    'coord_shift_m', coord_shift_m
  );
END;
$function$;
