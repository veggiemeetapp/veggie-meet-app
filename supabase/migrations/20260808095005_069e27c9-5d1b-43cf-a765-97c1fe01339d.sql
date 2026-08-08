-- WO-071 §4/§21: notification content and deep-link fields are server-authored.
-- Members may only flip their own read marker.
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- WO-071 §8: update_meetup_location was the only notification producer that
-- bypassed the canonical block suppression check in _insert_notification.
CREATE OR REPLACE FUNCTION public.update_meetup_location(_meetup_id uuid, _city_id uuid, _community_place_id uuid, _location_name text, _address text, _neighborhood text, _latitude double precision, _longitude double precision, _timezone text, _location_source location_source)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; m RECORD; city RECORD; place RECORD;
  meaningful boolean := false; notify_worthy boolean := false;
  coord_shift_m double precision := 0;
  change_id uuid; v_dedup text;
  recipients_ct int := 0; inserted_ct int := 0;
  old_mode text; new_mode text;
  new_place_name text; v_title text; v_body text;
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

  IF _community_place_id IS NOT NULL THEN
    SELECT * INTO place FROM public.community_places
     WHERE id = _community_place_id
       AND is_active
       AND verification_status = 'verified'
       AND COALESCE(maintenance_status, 'operational') = 'operational';
    IF place IS NULL THEN
      RAISE EXCEPTION 'That place is not available for hosting.';
    END IF;
  ELSIF _location_name IS NULL OR btrim(_location_name) = '' THEN
    RAISE EXCEPTION 'A location name is required.';
  END IF;

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
      power(sin(radians((_longitude - m.longitude)/2)), 2)));
  END IF;

  old_mode := CASE WHEN m.community_place_id IS NOT NULL THEN 'community_place' ELSE 'custom' END;
  new_mode := CASE WHEN _community_place_id IS NOT NULL THEN 'community_place' ELSE 'custom' END;

  meaningful := (
    COALESCE(m.city_id::text,'') IS DISTINCT FROM COALESCE(_city_id::text,'') OR
    COALESCE(m.community_place_id::text,'') IS DISTINCT FROM COALESCE(_community_place_id::text,'') OR
    COALESCE(lower(btrim(m.location_name)),'') IS DISTINCT FROM COALESCE(lower(btrim(_location_name)),'') OR
    COALESCE(lower(btrim(m.address)),'') IS DISTINCT FROM COALESCE(lower(btrim(_address)),'') OR
    COALESCE(m.timezone,'') IS DISTINCT FROM COALESCE(_timezone,'') OR
    coord_shift_m > 500);

  notify_worthy := (
    old_mode IS DISTINCT FROM new_mode OR
    COALESCE(m.community_place_id::text,'') IS DISTINCT FROM COALESCE(_community_place_id::text,'') OR
    (new_mode = 'custom' AND (
      COALESCE(lower(btrim(m.location_name)),'') IS DISTINCT FROM COALESCE(lower(btrim(_location_name)),'') OR
      COALESCE(lower(btrim(m.address)),'') IS DISTINCT FROM COALESCE(lower(btrim(_address)),'')
    )));

  INSERT INTO public.meetup_location_changes (meetup_id, changed_by_profile_id,
    old_city_id, new_city_id, old_location_name, new_location_name,
    old_address, new_address, old_latitude, old_longitude, new_latitude, new_longitude,
    old_timezone, new_timezone, meaningful_change,
    old_community_place_id, new_community_place_id, old_location_mode, new_location_mode)
  VALUES (_meetup_id, me, m.city_id, _city_id, m.location_name, _location_name,
    m.address, _address, m.latitude, m.longitude, _latitude, _longitude,
    m.timezone, _timezone, meaningful,
    m.community_place_id, _community_place_id, old_mode, new_mode)
  RETURNING id INTO change_id;

  UPDATE public.meetups SET
    city_id=_city_id, city_name_snapshot=city.name, country_code_snapshot=city.country_code,
    timezone=_timezone, neighborhood=_neighborhood, location_name=_location_name,
    address=_address, latitude=_latitude, longitude=_longitude,
    community_place_id=_community_place_id,
    location_source=COALESCE(_location_source, m.location_source),
    location_is_inferred=false, location_updated_at=now(), updated_at=now()
  WHERE id=_meetup_id;

  IF notify_worthy THEN
    IF _community_place_id IS NOT NULL THEN
      SELECT cp.name INTO new_place_name FROM public.community_places cp WHERE cp.id = _community_place_id;
    END IF;

    v_title := 'Meetup location changed';
    v_body := CASE
      WHEN new_mode = 'community_place' AND new_place_name IS NOT NULL THEN
        COALESCE(m.title,'A Meetup') || ' is now happening at ' || new_place_name || '.'
      WHEN new_mode = 'custom' AND old_mode = 'community_place' THEN
        COALESCE(m.title,'A Meetup') || ' now has a new custom location.'
      ELSE
        'The location for ' || COALESCE(m.title,'a Meetup') || ' has been updated.'
    END;

    v_dedup := 'meetup_location_changed:' || _meetup_id::text || ':' || change_id::text;

    WITH eligible_recipients AS (
      SELECT DISTINCT a.profile_id
        FROM public.attendance a
       WHERE a.meetup_id = _meetup_id
         AND a.profile_id IS NOT NULL
         AND a.profile_id <> me
         AND a.status::text NOT IN ('cancelled','removed')
         AND NOT public.is_blocked_between(me, a.profile_id)
    ),
    counted AS (SELECT count(*) AS n FROM eligible_recipients),
    inserted AS (
      INSERT INTO public.notifications (
        recipient_id, actor_id, type, entity_type, entity_id,
        destination_type, destination_id, title, body, metadata, dedup_key)
      SELECT er.profile_id, me, 'meetup_location_changed'::notification_type,
        'meetup', _meetup_id, 'meetup', _meetup_id,
        v_title, v_body,
        jsonb_build_object(
          'meetup_id', _meetup_id,
          'change_id', change_id,
          'old_location_mode', old_mode,
          'new_location_mode', new_mode,
          'new_place_name', new_place_name),
        v_dedup
      FROM eligible_recipients er
      WHERE COALESCE((SELECT np.meetup_updates FROM public.notification_preferences np
                       WHERE np.profile_id = er.profile_id), TRUE)
      ON CONFLICT (recipient_id, dedup_key) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT n FROM counted), (SELECT count(*) FROM inserted)
      INTO recipients_ct, inserted_ct;

    INSERT INTO public.analytics_events (profile_id, event_name, properties)
    VALUES (me, 'meetup_location_change_notification_created',
      jsonb_build_object('meetup_id', _meetup_id, 'recipient_count', inserted_ct,
                         'new_location_mode', new_mode));
  END IF;

  RETURN jsonb_build_object(
    'meetup_id', _meetup_id, 'change_id', change_id,
    'meaningful_change', meaningful, 'notified', notify_worthy,
    'coord_shift_m', coord_shift_m,
    'recipients_count', recipients_ct, 'notifications_inserted', inserted_ct
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_meetup_location(uuid, uuid, uuid, text, text, text, double precision, double precision, text, location_source) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_meetup_location(uuid, uuid, uuid, text, text, text, double precision, double precision, text, location_source) TO authenticated;
