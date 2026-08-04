-- Preference mapping for the new type
CREATE OR REPLACE FUNCTION public._insert_notification(_recipient uuid, _actor uuid, _type notification_type, _entity_type text, _entity_id uuid, _destination_type text, _destination_id uuid, _title text, _body text, _metadata jsonb, _dedup_key text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pref_col text;
  v_enabled boolean;
BEGIN
  IF _actor IS NOT NULL AND _actor = _recipient THEN RETURN; END IF;
  IF _recipient IS NULL THEN RETURN; END IF;

  v_pref_col := CASE _type
    WHEN 'connection_request_received' THEN 'connection_requests'
    WHEN 'connection_request_accepted' THEN 'connection_accepted'
    WHEN 'meetup_invitation_received'  THEN 'meetup_invitations'
    WHEN 'meetup_invitation_joined'    THEN 'meetup_invitations'
    WHEN 'meetup_updated'              THEN 'meetup_updates'
    WHEN 'meetup_cancelled'            THEN 'meetup_updates'
    WHEN 'meetup_attendee_removed'     THEN 'meetup_updates'
    WHEN 'meetup_location_changed'     THEN 'meetup_updates'
    WHEN 'place_suggestion_under_review' THEN 'community'
    WHEN 'place_suggestion_approved'     THEN 'community'
    WHEN 'place_suggestion_duplicate'    THEN 'community'
    WHEN 'place_suggestion_rejected'     THEN 'community'
    ELSE NULL
  END;

  IF v_pref_col IS NOT NULL THEN
    EXECUTE format(
      'SELECT COALESCE((SELECT %I FROM public.notification_preferences WHERE profile_id = $1), TRUE)',
      v_pref_col
    ) INTO v_enabled USING _recipient;
    IF v_enabled IS FALSE THEN RETURN; END IF;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, actor_id, type, entity_type, entity_id,
    destination_type, destination_id, title, body, metadata, dedup_key
  ) VALUES (
    _recipient, _actor, _type, _entity_type, _entity_id,
    _destination_type, _destination_id, _title, _body, COALESCE(_metadata,'{}'::jsonb), _dedup_key
  )
  ON CONFLICT (recipient_id, dedup_key) DO NOTHING;
END;
$function$;

-- Generic meetup-update notifier no longer covers location (dedicated type owns it)
CREATE OR REPLACE FUNCTION public.handle_meetup_notification()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  attendee RECORD;
  changed_fields text[] := ARRAY[]::text[];
  change_summary text;
  dedup text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  IF NEW.status = 'cancelled'::meetup_status
     AND OLD.status IS DISTINCT FROM 'cancelled'::meetup_status THEN
    dedup := 'meetup:' || NEW.id::text || ':cancelled';
    FOR attendee IN
      SELECT DISTINCT a.profile_id
        FROM public.attendance a
       WHERE a.meetup_id = NEW.id
         AND a.status::text NOT IN ('cancelled','removed')
         AND a.profile_id <> NEW.host_id
    LOOP
      PERFORM public._insert_notification(
        attendee.profile_id, NEW.host_id, 'meetup_cancelled',
        'meetup', NEW.id, 'meetup', NEW.id, NULL,
        COALESCE(NEW.title,'A Meetup') || ' was cancelled.',
        jsonb_build_object('meetup_id', NEW.id), dedup);
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled'::meetup_status THEN RETURN NEW; END IF;

  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changed_fields := array_append(changed_fields, 'title');
  END IF;
  IF OLD.date IS DISTINCT FROM NEW.date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time
     OR OLD.end_time IS DISTINCT FROM NEW.end_time THEN
    changed_fields := array_append(changed_fields, 'time');
  END IF;
  -- Location changes are announced by update_meetup_location via
  -- 'meetup_location_changed'; do not double-notify here.

  IF array_length(changed_fields,1) IS NULL THEN RETURN NEW; END IF;

  change_summary := CASE
    WHEN array_length(changed_fields,1) = 1 THEN 'its ' || changed_fields[1]
    ELSE 'its ' || changed_fields[1] || ' and ' || changed_fields[2]
  END;

  dedup := 'meetup:' || NEW.id::text || ':update:' || extract(epoch from NEW.updated_at)::text;

  FOR attendee IN
    SELECT DISTINCT a.profile_id
      FROM public.attendance a
     WHERE a.meetup_id = NEW.id
       AND a.status::text NOT IN ('cancelled','removed')
       AND a.profile_id <> NEW.host_id
  LOOP
    PERFORM public._insert_notification(
      attendee.profile_id, NEW.host_id, 'meetup_updated',
      'meetup', NEW.id, 'meetup', NEW.id, NULL,
      COALESCE(NEW.title,'A Meetup') || ' changed ' || change_summary || '.',
      jsonb_build_object('meetup_id', NEW.id, 'changed_fields', to_jsonb(changed_fields)),
      dedup);
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Host location update: dedicated, idempotent, server-authoritative notifications
CREATE OR REPLACE FUNCTION public.update_meetup_location(_meetup_id uuid, _city_id uuid, _community_place_id uuid, _location_name text, _address text, _neighborhood text, _latitude double precision, _longitude double precision, _timezone text, _location_source location_source)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  me uuid; m RECORD; city RECORD;
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

  -- Notification-worthy = user-facing location identity changed (normalized compare).
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
    -- Server-resolved public place name only (never client-supplied labels).
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

REVOKE ALL ON FUNCTION public.update_meetup_location(uuid,uuid,uuid,text,text,text,double precision,double precision,text,location_source) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_meetup_location(uuid,uuid,uuid,text,text,text,double precision,double precision,text,location_source) TO authenticated;
REVOKE ALL ON FUNCTION public._insert_notification(uuid,uuid,notification_type,text,uuid,text,uuid,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
