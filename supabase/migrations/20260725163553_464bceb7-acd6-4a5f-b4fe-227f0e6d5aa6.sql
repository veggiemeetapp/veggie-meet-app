
-- =========================================================================
-- WO-035 Phase 2: Canonical location RPCs + Today rewire
-- =========================================================================

-- Helper: resolve the viewer's effective city id (preferences → home → legacy text).
CREATE OR REPLACE FUNCTION public.resolve_viewer_city_id(_profile_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT pp.selected_city_id FROM public.profile_preferences pp WHERE pp.profile_id = _profile_id),
    (SELECT p.home_city_id      FROM public.profiles p             WHERE p.id = _profile_id),
    (SELECT c.id
       FROM public.profiles p
       JOIN public.cities c ON lower(btrim(p.current_city)) = lower(c.name)
      WHERE p.id = _profile_id
      LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.resolve_viewer_city_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_viewer_city_id(uuid) TO authenticated, service_role;

-- Public browse of active cities.
CREATE OR REPLACE FUNCTION public.get_active_cities()
RETURNS TABLE(id uuid, name text, country_code text, country_name text, timezone text, latitude double precision, longitude double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT id, name, country_code, country_name, timezone, latitude, longitude
    FROM public.cities
   WHERE is_active
   ORDER BY name;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_cities() TO anon, authenticated;

-- Set selected city.
CREATE OR REPLACE FUNCTION public.set_selected_city(_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; ok boolean;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _city_id IS NOT NULL THEN
    SELECT is_active INTO ok FROM public.cities WHERE id = _city_id;
    IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'City unavailable'; END IF;
  END IF;
  INSERT INTO public.profile_preferences (profile_id, selected_city_id)
  VALUES (me, _city_id)
  ON CONFLICT (profile_id) DO UPDATE
    SET selected_city_id = EXCLUDED.selected_city_id,
        updated_at = now();
  RETURN jsonb_build_object('selected_city_id', _city_id);
END; $$;
REVOKE ALL ON FUNCTION public.set_selected_city(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_selected_city(uuid) TO authenticated;

-- Set home city.
CREATE OR REPLACE FUNCTION public.set_home_city(_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; c RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _city_id IS NOT NULL THEN
    SELECT * INTO c FROM public.cities WHERE id = _city_id;
    IF c IS NULL OR NOT c.is_active THEN RAISE EXCEPTION 'City unavailable'; END IF;
  END IF;
  UPDATE public.profiles
     SET home_city_id = _city_id,
         current_city = COALESCE(c.name, current_city),
         updated_at = now()
   WHERE id = me;
  RETURN jsonb_build_object('home_city_id', _city_id);
END; $$;
REVOKE ALL ON FUNCTION public.set_home_city(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_home_city(uuid) TO authenticated;

-- Location context.
CREATE OR REPLACE FUNCTION public.get_my_location_context()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; home jsonb; sel jsonb; sel_id uuid; home_id uuid; tz text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT home_city_id INTO home_id FROM public.profiles WHERE id = me;
  SELECT selected_city_id INTO sel_id FROM public.profile_preferences WHERE profile_id = me;

  SELECT to_jsonb(x) INTO home FROM (
    SELECT id, name, country_code, country_name, timezone, latitude, longitude
      FROM public.cities WHERE id = home_id
  ) x;

  SELECT to_jsonb(x) INTO sel FROM (
    SELECT id, name, country_code, country_name, timezone, latitude, longitude
      FROM public.cities WHERE id = COALESCE(sel_id, home_id)
  ) x;

  tz := COALESCE(sel->>'timezone', home->>'timezone');

  RETURN jsonb_build_object(
    'home_city', home,
    'selected_city', sel,
    'timezone', tz,
    'distance_available', false  -- device coordinates live only in the client
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_my_location_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_location_context() TO authenticated;

-- Update meetup location (host-only, before end, with meaningful-change detection).
CREATE OR REPLACE FUNCTION public.update_meetup_location(
  _meetup_id uuid,
  _city_id uuid,
  _community_place_id uuid,
  _location_name text,
  _address text,
  _neighborhood text,
  _latitude double precision,
  _longitude double precision,
  _timezone text,
  _location_source public.location_source
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  me uuid;
  m RECORD;
  city RECORD;
  meaningful boolean := false;
  coord_shift_m double precision := 0;
  change_id uuid;
  dedup_key text;
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

  -- Validate city
  IF _city_id IS NULL THEN RAISE EXCEPTION 'City is required'; END IF;
  SELECT * INTO city FROM public.cities WHERE id = _city_id AND is_active;
  IF city IS NULL THEN RAISE EXCEPTION 'City unavailable'; END IF;

  -- Validate coords: both or neither
  IF (_latitude IS NULL) <> (_longitude IS NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must both be provided or both omitted';
  END IF;
  IF _latitude IS NOT NULL AND (_latitude NOT BETWEEN -90 AND 90 OR _longitude NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;

  -- Timezone defaults from city if not supplied
  IF _timezone IS NULL OR btrim(_timezone) = '' THEN
    _timezone := city.timezone;
  END IF;

  -- Coordinate shift in meters (Haversine)
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

  -- Write audit entry
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

  -- Apply update
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

  -- Notify attendees exactly once per meaningful change
  IF meaningful THEN
    dedup_key := 'meetup_location_changed:' || _meetup_id::text || ':' || change_id::text;
    PERFORM public._insert_notification(
      a.profile_id, me, 'meetup_updated'::notification_type,
      'meetup', _meetup_id, 'meetup', _meetup_id,
      NULL,
      'Location updated for ' || COALESCE(m.title,'a Meetup') || '.',
      jsonb_build_object(
        'meetup_id', _meetup_id,
        'change_id', change_id,
        'new_city', city.name,
        'new_location_name', _location_name,
        'new_timezone', _timezone,
        'timezone_changed', (COALESCE(m.timezone,'') IS DISTINCT FROM COALESCE(_timezone,''))
      ),
      dedup_key
    )
    FROM public.attendance a
    WHERE a.meetup_id = _meetup_id
      AND a.profile_id <> me
      AND a.status::text NOT IN ('cancelled','removed');
  END IF;

  RETURN jsonb_build_object(
    'meetup_id', _meetup_id,
    'change_id', change_id,
    'meaningful_change', meaningful,
    'coord_shift_m', coord_shift_m
  );
END; $$;
REVOKE ALL ON FUNCTION public.update_meetup_location(uuid,uuid,uuid,text,text,text,double precision,double precision,text,public.location_source) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_meetup_location(uuid,uuid,uuid,text,text,text,double precision,double precision,text,public.location_source) TO authenticated;

-- Meetup insert trigger: snapshot location from community place or host's selected/home city.
CREATE OR REPLACE FUNCTION public.snapshot_meetup_location_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE cp RECORD; c RECORD; viewer_city uuid;
BEGIN
  -- If host linked a place, snapshot from it.
  IF NEW.community_place_id IS NOT NULL AND (NEW.city_id IS NULL OR NEW.timezone IS NULL) THEN
    SELECT cp.*, ci.name AS ci_name, ci.country_code AS ci_country, ci.timezone AS ci_tz
      INTO cp
      FROM public.community_places cp
      LEFT JOIN public.cities ci ON ci.id = cp.city_id
     WHERE cp.id = NEW.community_place_id;
    IF cp IS NOT NULL THEN
      NEW.city_id                := COALESCE(NEW.city_id, cp.city_id);
      NEW.city_name_snapshot     := COALESCE(NEW.city_name_snapshot, cp.ci_name);
      NEW.country_code_snapshot  := COALESCE(NEW.country_code_snapshot, cp.ci_country);
      NEW.timezone               := COALESCE(NEW.timezone, cp.timezone, cp.ci_tz);
      NEW.neighborhood           := COALESCE(NEW.neighborhood, cp.neighborhood);
      NEW.location_name          := COALESCE(NEW.location_name, cp.name);
      NEW.address                := COALESCE(NEW.address, cp.address);
      NEW.latitude               := COALESCE(NEW.latitude, cp.latitude);
      NEW.longitude              := COALESCE(NEW.longitude, cp.longitude);
      NEW.location_source        := COALESCE(NEW.location_source, 'community_place'::public.location_source);
    END IF;
  END IF;

  -- Fallback: use the host's selected city then home city.
  IF NEW.city_id IS NULL THEN
    viewer_city := public.resolve_viewer_city_id(NEW.host_id);
    IF viewer_city IS NOT NULL THEN
      SELECT * INTO c FROM public.cities WHERE id = viewer_city;
      NEW.city_id               := c.id;
      NEW.city_name_snapshot    := COALESCE(NEW.city_name_snapshot, c.name);
      NEW.country_code_snapshot := COALESCE(NEW.country_code_snapshot, c.country_code);
      NEW.timezone              := COALESCE(NEW.timezone, c.timezone);
      NEW.location_source       := COALESCE(NEW.location_source, 'host_selected_city'::public.location_source);
      NEW.location_is_inferred  := true;
    END IF;
  END IF;

  IF NEW.location_source IS NULL THEN
    NEW.location_source      := 'unknown'::public.location_source;
    NEW.location_is_inferred := true;
  END IF;
  NEW.location_updated_at := COALESCE(NEW.location_updated_at, now());
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS snapshot_meetup_location_trg ON public.meetups;
CREATE TRIGGER snapshot_meetup_location_trg
  BEFORE INSERT ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_meetup_location_on_insert();

-- =========================================================================
-- Rewire get_my_today_experience to use persisted meetup/place city_id.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_my_today_experience()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  my_city text;
  my_city_id uuid;
  my_interests text[];
  now_ts timestamptz := now();
  today_date date := (now() AT TIME ZONE 'UTC')::date;
  primary_action jsonb := NULL;
  meetup_recs jsonb := '[]'::jsonb;
  veggie_recs jsonb := '[]'::jsonb;
  place_recs jsonb := '[]'::jsonb;
  used_meetup_ids uuid[] := ARRAY[]::uuid[];
  primary_entity_type text := NULL;
  primary_entity_id text := NULL;
BEGIN
  SELECT id, current_city, interests INTO me, my_city, my_interests
  FROM profiles WHERE auth_user_id = auth.uid();
  IF me IS NULL THEN
    RETURN jsonb_build_object(
      'generated_at', now_ts, 'primary_action', NULL,
      'meetup_recommendations','[]'::jsonb,'veggie_recommendations','[]'::jsonb,'place_recommendations','[]'::jsonb
    );
  END IF;

  my_city_id := public.resolve_viewer_city_id(me);
  IF my_city_id IS NOT NULL THEN
    SELECT name INTO my_city FROM public.cities WHERE id = my_city_id;
  END IF;

  -- 1) Active check-in
  SELECT jsonb_build_object(
    'action_type','open_check_in',
    'entity_type','meetup','entity_id', m.id::text,
    'title','You can check in now',
    'supporting_text', m.title,
    'reason_code','check_in_active','reason_label','Check-in window is open',
    'action_label','Check in',
    'secondary_action_label','View meetup',
    'time_context', to_char(m.start_time,'HH12:MI AM')
  )
  INTO primary_action
  FROM meetups m
  JOIN attendance a ON a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in','attended')
  WHERE m.status NOT IN ('cancelled','past')
    AND m.date = today_date
    AND a.checked_in_at IS NULL
    AND now_ts BETWEEN (m.date::timestamp + m.start_time - interval '30 minutes')
                   AND (m.date::timestamp + m.end_time + interval '60 minutes')
  ORDER BY m.start_time LIMIT 1;
  IF primary_action IS NOT NULL THEN
    primary_entity_type := 'meetup'; primary_entity_id := primary_action->>'entity_id';
  END IF;

  -- 2) Starting soon
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','view_meetup','entity_type','meetup','entity_id', m.id::text,
      'title','Your meetup starts soon','supporting_text', m.title,
      'reason_code','starts_soon',
      'reason_label','Starts in ' || GREATEST(1, (EXTRACT(EPOCH FROM ((m.date::timestamp + m.start_time) - now_ts))/60)::int)::text || ' min',
      'action_label','View meetup',
      'time_context', to_char(m.start_time,'HH12:MI AM')
    ) INTO primary_action
    FROM meetups m
    JOIN attendance a ON a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in')
    WHERE m.status NOT IN ('cancelled','past')
      AND (m.date::timestamp + m.start_time) BETWEEN now_ts AND (now_ts + interval '90 minutes')
    ORDER BY (m.date::timestamp + m.start_time) LIMIT 1;
    IF primary_action IS NOT NULL THEN
      primary_entity_type := 'meetup'; primary_entity_id := primary_action->>'entity_id';
    END IF;
  END IF;

  -- 3) Pending invitation
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','respond_invitation','entity_type','invitation','entity_id', mi.id::text,
      'title', sender.display_name || ' invited you to a meetup',
      'supporting_text', m.title,
      'reason_code','invitation_pending','reason_label','Awaiting your response',
      'action_label','Review invitation',
      'time_context', to_char(m.date,'Mon DD')
    ) INTO primary_action
    FROM meetup_invitations mi
    JOIN meetups m ON m.id = mi.meetup_id
    JOIN profiles sender ON sender.id = mi.sender_id
    WHERE mi.recipient_id = me AND mi.status IN ('invited','viewed') AND mi.joined_at IS NULL
      AND m.status NOT IN ('cancelled','past') AND m.date >= today_date
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = mi.sender_id) OR (ub.blocker_profile_id = mi.sender_id AND ub.blocked_profile_id = me))
    ORDER BY mi.created_at DESC LIMIT 1;
  END IF;

  -- 4) Post-meetup follow-up
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','view_summary','entity_type','meetup','entity_id', m.id::text,
      'title','See who you met','supporting_text', m.title,
      'reason_code','post_meetup_follow_up','reason_label','From your recent meetup',
      'action_label','View summary','time_context', to_char(m.date,'Mon DD')
    ) INTO primary_action
    FROM attendance a
    JOIN meetups m ON m.id = a.meetup_id
    LEFT JOIN meetup_follow_up_state s ON s.meetup_id = m.id AND s.profile_id = me
    WHERE a.profile_id = me AND a.status IN ('attended','checked_in')
      AND m.date BETWEEN (today_date - 7) AND today_date
      AND m.status IN ('past','in_progress','upcoming')
      AND (s.viewed_at IS NULL AND s.dismissed_at IS NULL)
    ORDER BY m.date DESC, m.start_time DESC LIMIT 1;
    IF primary_action IS NOT NULL THEN
      primary_entity_type := 'meetup'; primary_entity_id := primary_action->>'entity_id';
    END IF;
  END IF;

  -- 5) Pending connection request
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','respond_connection','entity_type','friendship','entity_id', f.id::text,
      'title', requester.display_name || ' wants to connect',
      'supporting_text','Review this connection request',
      'reason_code','connection_request','reason_label','Awaiting your response',
      'action_label','Review request'
    ) INTO primary_action
    FROM friendships f
    JOIN profiles requester ON requester.id = f.requester_id
    WHERE f.status = 'pending' AND f.requester_id <> me
      AND (f.profile_a_id = me OR f.profile_b_id = me)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = f.requester_id) OR (ub.blocker_profile_id = f.requester_id AND ub.blocked_profile_id = me))
    ORDER BY f.created_at DESC LIMIT 1;
  END IF;

  IF primary_action IS NOT NULL AND primary_entity_type = 'meetup' AND primary_entity_id IS NOT NULL THEN
    used_meetup_ids := array_append(used_meetup_ids, primary_entity_id::uuid);
  END IF;

  -- Meetup recommendations — filter by persisted meetup city_id.
  WITH hidden AS (
    SELECT entity_id FROM recommendation_feedback
    WHERE profile_id = me AND surface='today' AND entity_type='meetup' AND expires_at > now_ts
  ),
  eligible AS (
    SELECT m.id, m.title, m.category, m.date, m.start_time, m.end_time, m.cover_image_url, m.host_id, m.capacity,
      (SELECT COUNT(*) FROM attendance a WHERE a.meetup_id = m.id AND a.status IN ('joined','checked_in','attended')) AS attendee_count,
      EXISTS (SELECT 1 FROM attendance a WHERE a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in','attended')) AS is_attending,
      EXISTS (SELECT 1 FROM attendance a WHERE a.meetup_id = m.id AND a.profile_id = me AND a.status = 'removed') AS is_removed,
      m.city_id AS meetup_city_id,
      (CASE WHEN m.date = today_date THEN 100
            WHEN m.date = today_date + 1 THEN 60
            WHEN m.date <= today_date + 7 THEN 40
            ELSE 20 END)
      + (CASE WHEN my_city_id IS NOT NULL AND m.city_id = my_city_id THEN 30 ELSE 0 END)
      + (CASE WHEN m.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN 20 ELSE 0 END) AS score
    FROM meetups m
    WHERE m.status NOT IN ('cancelled','past')
      AND (m.date > today_date OR (m.date = today_date AND m.end_time >= (now_ts AT TIME ZONE 'UTC')::time))
      AND m.host_id <> me
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = m.host_id) OR (ub.blocker_profile_id = m.host_id AND ub.blocked_profile_id = me))
      AND m.id <> ALL(used_meetup_ids)
      AND m.id::text NOT IN (SELECT entity_id FROM hidden)
      AND (my_city_id IS NULL OR m.city_id IS NULL OR m.city_id = my_city_id)
  ),
  final AS (
    SELECT e.*,
      CASE
        WHEN e.date = today_date THEN 'happening_today'
        WHEN (e.date::timestamp + e.start_time) <= (now_ts + interval '90 minutes') THEN 'starts_soon'
        WHEN e.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN 'matches_your_interests'
        WHEN my_city_id IS NOT NULL AND e.meetup_city_id = my_city_id THEN 'in_your_city'
        ELSE 'new_meetup'
      END AS reason_code_calc
    FROM eligible e
    WHERE (e.is_attending OR (e.capacity > e.attendee_count)) AND NOT e.is_removed
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, date, start_time, id), '[]'::jsonb) INTO meetup_recs
  FROM (
    SELECT f.id, f.score, f.date, f.start_time,
      jsonb_build_object(
        'entity_type','meetup','entity_id', f.id::text,
        'title', f.title, 'category', f.category,
        'date', f.date, 'start_time', f.start_time, 'end_time', f.end_time,
        'cover_image_url', f.cover_image_url, 'host_id', f.host_id::text,
        'attendee_count', f.attendee_count, 'capacity', f.capacity, 'is_attending', f.is_attending,
        'reason_code', f.reason_code_calc,
        'reason_label', CASE f.reason_code_calc
          WHEN 'happening_today' THEN 'Happening today'
          WHEN 'starts_soon' THEN 'Starting soon'
          WHEN 'matches_your_interests' THEN 'Matches your interests'
          WHEN 'in_your_city' THEN 'In ' || COALESCE(my_city,'your city')
          ELSE 'New meetup'
        END,
        'action_type', CASE WHEN f.is_attending THEN 'view_meetup' ELSE 'join_meetup' END
      ) AS row_json
    FROM final f
    ORDER BY score DESC, date, start_time, id LIMIT 3
  ) t;

  used_meetup_ids := COALESCE((SELECT array_agg((v->>'entity_id')::uuid) FROM jsonb_array_elements(meetup_recs) v), ARRAY[]::uuid[]);
  IF primary_entity_type='meetup' AND primary_entity_id IS NOT NULL THEN
    used_meetup_ids := array_append(used_meetup_ids, primary_entity_id::uuid);
  END IF;

  -- Veggie recommendations — persistent-city version of WO-034D cross-city rule.
  WITH hidden AS (
    SELECT entity_id FROM recommendation_feedback
    WHERE profile_id = me AND surface='today' AND entity_type='profile' AND expires_at > now_ts
  ),
  candidates AS (
    SELECT p.id, p.display_name, p.avatar_url, p.current_city, p.interests,
      (
        SELECT jsonb_build_object('id', m.id::text, 'title', m.title, 'date', m.date)
        FROM attendance a1
        JOIN attendance a2 ON a2.meetup_id = a1.meetup_id
        JOIN meetups m ON m.id = a1.meetup_id
        WHERE a1.profile_id = me AND a2.profile_id = p.id
          AND a1.status IN ('joined','checked_in','attended')
          AND a2.status IN ('joined','checked_in','attended')
          AND m.status NOT IN ('cancelled','past')
          AND (m.date > today_date OR (m.date = today_date AND m.end_time >= (now_ts AT TIME ZONE 'UTC')::time))
          AND my_city_id IS NOT NULL
          AND m.city_id = my_city_id
        ORDER BY m.date, m.start_time LIMIT 1
      ) AS shared_upcoming_meetup,
      cardinality(ARRAY(SELECT unnest(p.interests) INTERSECT SELECT unnest(COALESCE(my_interests, ARRAY[]::text[])))) AS shared_interest_count,
      (my_city_id IS NOT NULL AND p.home_city_id = my_city_id) AS same_city
    FROM profiles p
    WHERE p.id <> me AND p.onboarding_completed = true
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = p.id) OR (ub.blocker_profile_id = p.id AND ub.blocked_profile_id = me))
      AND NOT EXISTS (SELECT 1 FROM friendships f
        WHERE f.status IN ('connected','verified','pending','blocked','removed')
        AND ((f.profile_a_id = me AND f.profile_b_id = p.id) OR (f.profile_a_id = p.id AND f.profile_b_id = me)))
      AND p.id::text NOT IN (SELECT entity_id FROM hidden)
  ),
  ranked AS (
    SELECT c.*,
      (CASE WHEN c.shared_upcoming_meetup IS NOT NULL THEN 60 ELSE 0 END
        + CASE WHEN c.same_city THEN c.shared_interest_count * 15 ELSE 0 END
        + CASE WHEN c.same_city THEN 20 ELSE 0 END) AS score,
      CASE
        WHEN c.shared_upcoming_meetup IS NOT NULL THEN 'same_meetup'
        WHEN c.same_city AND c.shared_interest_count > 0 THEN 'shared_interest'
        WHEN c.same_city THEN 'in_your_city'
        ELSE NULL
      END AS reason_code_calc,
      (SELECT i FROM unnest(c.interests) AS i WHERE i = ANY(COALESCE(my_interests, ARRAY[]::text[])) LIMIT 1) AS shared_interest_name
    FROM candidates c
    WHERE c.shared_upcoming_meetup IS NOT NULL OR c.same_city
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, id), '[]'::jsonb) INTO veggie_recs
  FROM (
    SELECT r.id, r.score,
      jsonb_build_object(
        'entity_type','profile','entity_id', r.id::text,
        'display_name', r.display_name, 'avatar_url', r.avatar_url,
        'current_city', r.current_city, 'interests', to_jsonb(r.interests),
        'reason_code', r.reason_code_calc,
        'reason_label', CASE r.reason_code_calc
          WHEN 'same_meetup' THEN 'You’re both going to ' || (r.shared_upcoming_meetup->>'title')
          WHEN 'shared_interest' THEN 'Shares ' || COALESCE(r.shared_interest_name,'an interest')
          WHEN 'in_your_city' THEN 'In ' || COALESCE(my_city,'your city')
          ELSE 'New to VeggieMeet'
        END,
        'shared_meetup_id', r.shared_upcoming_meetup->>'id',
        'action_type','view_profile'
      ) AS row_json
    FROM ranked r
    WHERE r.reason_code_calc IS NOT NULL
    ORDER BY score DESC, id LIMIT 3
  ) t;

  -- Place recommendations — filter by persisted city_id + is_active.
  WITH hidden AS (
    SELECT entity_id FROM recommendation_feedback
    WHERE profile_id = me AND surface='today' AND entity_type='place' AND expires_at > now_ts
  ),
  supported AS (
    SELECT DISTINCT community_place_id AS place_id FROM place_check_ins WHERE profile_id = me
  ),
  candidates AS (
    SELECT cp.id, cp.name, cp.category, cp.address, cp.cover_image_url, cp.upcoming_meetups_count,
      EXISTS (SELECT 1 FROM meetups m WHERE m.community_place_id = cp.id AND m.status NOT IN ('cancelled','past') AND m.date >= today_date) AS has_upcoming,
      (cp.id::text IN (SELECT place_id FROM supported)) AS supported_by_me
    FROM community_places cp
    WHERE cp.is_active
      AND (my_city_id IS NULL OR cp.city_id IS NULL OR cp.city_id = my_city_id)
      AND cp.id::text NOT IN (SELECT entity_id FROM hidden)
  ),
  ranked AS (
    SELECT c.*,
      (CASE WHEN c.has_upcoming THEN 60 ELSE 0 END
       + CASE WHEN NOT c.supported_by_me THEN 30 ELSE 5 END
       + CASE WHEN c.upcoming_meetups_count > 0 THEN 10 ELSE 0 END) AS score,
      CASE WHEN c.has_upcoming THEN 'upcoming_meetup_here'
           WHEN NOT c.supported_by_me THEN 'new_place'
           ELSE 'community_place' END AS reason_code_calc
    FROM candidates c
    WHERE (NOT c.supported_by_me) OR c.has_upcoming
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, id), '[]'::jsonb) INTO place_recs
  FROM (
    SELECT r.id, r.score,
      jsonb_build_object(
        'entity_type','place','entity_id', r.id::text,
        'name', r.name, 'category', r.category, 'address', r.address,
        'cover_image_url', r.cover_image_url,
        'reason_code', r.reason_code_calc,
        'reason_label', CASE r.reason_code_calc
          WHEN 'upcoming_meetup_here' THEN 'Upcoming meetup here'
          WHEN 'new_place' THEN 'You haven’t supported this Place yet'
          ELSE 'Community Place'
        END,
        'action_type','view_place'
      ) AS row_json
    FROM ranked r
    ORDER BY score DESC, id LIMIT 3
  ) t;

  RETURN jsonb_build_object(
    'generated_at', now_ts,
    'selected_city', my_city,
    'selected_city_id', my_city_id,
    'primary_action', primary_action,
    'meetup_recommendations', COALESCE(meetup_recs,'[]'::jsonb),
    'veggie_recommendations', COALESCE(veggie_recs,'[]'::jsonb),
    'place_recommendations', COALESCE(place_recs,'[]'::jsonb)
  );
END $function$;
