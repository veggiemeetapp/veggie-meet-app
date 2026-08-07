-- 1. Snapshot stability: only (re)snapshot from the Community Place on INSERT
--    or when the host intentionally changes which place the Meetup is at, or
--    when the trusted location RPC asks for a refresh.
CREATE OR REPLACE FUNCTION public.enforce_meetup_community_place()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cp RECORD; do_snapshot boolean;
BEGIN
  IF NEW.community_place_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.*, ci.name AS ci_name, ci.country_code AS ci_country, ci.timezone AS ci_tz
    INTO cp
    FROM public.community_places p
    LEFT JOIN public.cities ci ON ci.id = p.city_id
   WHERE p.id = NEW.community_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This place isn''t available. [place_unavailable]';
  END IF;

  do_snapshot := TG_OP = 'INSERT'
    OR COALESCE(OLD.community_place_id::text, '') IS DISTINCT FROM NEW.community_place_id::text
    OR COALESCE(current_setting('app.meetup_resnapshot', true), '') = 'on';

  -- Eligibility is enforced only when the link is being established/refreshed.
  -- Unrelated edits (title, capacity, cancellation) on an existing linked
  -- Meetup must never fail because the place changed state later.
  IF do_snapshot THEN
    IF cp.verification_status <> 'verified'
       OR cp.is_active IS NOT TRUE
       OR COALESCE(cp.maintenance_status, 'operational') <> 'operational'
       OR COALESCE(cp.veggie_classification, '') <> 'fully_vegan'
       OR (cp.business_status IS NOT NULL AND cp.business_status <> 'OPERATIONAL') THEN
      RAISE EXCEPTION 'This place isn''t available. [place_unavailable]';
    END IF;
    IF cp.city_id IS NULL THEN
      RAISE EXCEPTION 'This place isn''t available in your city. [unsupported_city]';
    END IF;
    IF NEW.city_id IS NOT NULL AND NEW.city_id <> cp.city_id THEN
      RAISE EXCEPTION 'This place isn''t available in your city. [unsupported_city]';
    END IF;

    NEW.city_id               := cp.city_id;
    NEW.city_name_snapshot    := cp.ci_name;
    NEW.country_code_snapshot := cp.ci_country;
    NEW.timezone              := COALESCE(cp.timezone, cp.ci_tz, NEW.timezone);
    NEW.neighborhood          := cp.neighborhood;
    NEW.location_name         := cp.name;
    NEW.address               := cp.address;
    NEW.latitude              := cp.latitude;
    NEW.longitude             := cp.longitude;
    NEW.location_source       := 'community_place'::public.location_source;
    NEW.location_is_inferred  := false;
    NEW.custom_location_name  := NULL;
    NEW.custom_location_address := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Shared, server-side integrity comparison helper (never exposes coordinates).
CREATE OR REPLACE FUNCTION public._meetup_place_integrity(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD; p RECORD;
  state text := 'current';
  shift_m double precision := NULL;
  changed text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF NOT FOUND OR m.community_place_id IS NULL THEN
    RETURN jsonb_build_object('linked', false);
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = m.community_place_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('linked', true, 'state', 'place_hidden',
                              'changed_fields', to_jsonb(changed));
  END IF;

  IF m.latitude IS NOT NULL AND p.latitude IS NOT NULL THEN
    shift_m := 2 * 6371000 * asin(sqrt(
      power(sin(radians((p.latitude - m.latitude)/2)), 2) +
      cos(radians(m.latitude)) * cos(radians(p.latitude)) *
      power(sin(radians((p.longitude - m.longitude)/2)), 2)));
  END IF;

  IF lower(btrim(COALESCE(p.name,''))) IS DISTINCT FROM lower(btrim(COALESCE(m.location_name,''))) THEN
    changed := array_append(changed, 'name');
  END IF;
  IF lower(btrim(COALESCE(p.address,''))) IS DISTINCT FROM lower(btrim(COALESCE(m.address,''))) THEN
    changed := array_append(changed, 'address');
  END IF;
  IF lower(btrim(COALESCE(p.neighborhood,''))) IS DISTINCT FROM lower(btrim(COALESCE(m.neighborhood,''))) THEN
    changed := array_append(changed, 'neighborhood');
  END IF;

  -- Precedence: availability first, then identity, then details.
  state := CASE
    WHEN p.is_active IS NOT TRUE THEN 'place_hidden'
    WHEN COALESCE(p.maintenance_status,'operational') = 'permanently_closed'
      OR COALESCE(p.business_status,'OPERATIONAL') = 'CLOSED_PERMANENTLY' THEN 'permanently_unavailable'
    WHEN COALESCE(p.veggie_classification,'') <> 'fully_vegan'
      OR p.verification_status <> 'verified' THEN 'vegan_status_unconfirmed'
    WHEN COALESCE(p.maintenance_status,'operational') = 'temporarily_closed'
      OR COALESCE(p.business_status,'OPERATIONAL') = 'CLOSED_TEMPORARILY' THEN 'temporarily_unavailable'
    WHEN COALESCE(shift_m, 0) > 200 THEN 'relocated'
    WHEN array_length(changed, 1) IS NOT NULL THEN 'details_changed'
    ELSE 'current'
  END;

  RETURN jsonb_build_object(
    'linked', true,
    'state', state,
    'changed_fields', to_jsonb(changed),
    'relocated', COALESCE(shift_m, 0) > 200
  );
END;
$$;

REVOKE ALL ON FUNCTION public._meetup_place_integrity(uuid) FROM PUBLIC;

-- 3. Member-safe Meetup Community Place context.
CREATE OR REPLACE FUNCTION public.get_meetup_place_context(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid; m RECORD; p RECORD;
  integ jsonb; state text;
  visits int := 0;
  publicly_available boolean;
  action_required boolean;
  is_host boolean;
  historical boolean;
  status_label text; member_message text;
  host_block jsonb := NULL;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  IF m.community_place_id IS NULL THEN
    RETURN jsonb_build_object('found', true, 'linked', false);
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = m.community_place_id;
  integ := public._meetup_place_integrity(_meetup_id);
  state := integ->>'state';
  is_host := m.host_id = me;
  historical := m.status IN ('past'::meetup_status, 'cancelled'::meetup_status)
                OR (m.date + COALESCE(m.end_time, m.start_time)) <= now();

  publicly_available := p.id IS NOT NULL
    AND p.is_active IS TRUE
    AND p.verification_status = 'verified'
    AND COALESCE(p.veggie_classification,'') = 'fully_vegan'
    AND COALESCE(p.maintenance_status,'operational') <> 'permanently_closed';

  SELECT count(*)::int INTO visits
    FROM public.community_place_visits v
   WHERE v.profile_id = me
     AND v.community_place_id = m.community_place_id
     AND v.verification_status = 'verified';

  status_label := CASE state
    WHEN 'current' THEN 'Verified Community Place'
    WHEN 'details_changed' THEN 'Verified Community Place'
    WHEN 'relocated' THEN 'Location needs attention'
    WHEN 'temporarily_unavailable' THEN 'Temporarily closed'
    WHEN 'vegan_status_unconfirmed' THEN 'Location under review'
    ELSE 'No longer available'
  END;

  member_message := CASE state
    WHEN 'temporarily_unavailable' THEN 'This Community Place is temporarily closed.'
    WHEN 'relocated' THEN 'The Community Place has changed since this Meetup was created.'
    WHEN 'vegan_status_unconfirmed' THEN 'The Meetup location is being reviewed.'
    WHEN 'permanently_unavailable' THEN 'The planned location is no longer available. The host is reviewing the Meetup location.'
    WHEN 'place_hidden' THEN 'This Community Place is no longer available for new VeggieMeet activity.'
    ELSE NULL
  END;

  action_required := NOT historical AND state NOT IN ('current', 'details_changed');

  IF is_host THEN
    host_block := jsonb_build_object(
      'action_required', action_required,
      'action_level', CASE
        WHEN historical THEN 'none'
        WHEN state IN ('permanently_unavailable', 'place_hidden', 'vegan_status_unconfirmed') THEN 'required'
        WHEN state IN ('relocated', 'temporarily_unavailable') THEN 'recommended'
        WHEN state = 'details_changed' THEN 'optional'
        ELSE 'none'
      END,
      'status_label', CASE state
        WHEN 'current' THEN 'Up to date'
        WHEN 'details_changed' THEN 'Place details changed'
        WHEN 'relocated' THEN 'Place relocated'
        WHEN 'temporarily_unavailable' THEN 'Temporarily closed'
        WHEN 'vegan_status_unconfirmed' THEN 'Vegan verification changed'
        ELSE 'Place no longer available'
      END,
      'changed_fields', integ->'changed_fields',
      'can_accept_current_place', NOT historical
        AND publicly_available
        AND COALESCE(p.maintenance_status,'operational') = 'operational'
        AND COALESCE(p.business_status,'OPERATIONAL') = 'OPERATIONAL'
        AND state IN ('details_changed', 'relocated'),
      'current_place', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
        'name', p.name,
        'address', p.address,
        'neighborhood', p.neighborhood,
        'category', p.category::text,
        'is_publicly_available', publicly_available
      ) END
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'linked', true,
    'is_host', is_host,
    'is_historical', historical,
    'community_place', jsonb_build_object(
      'id', m.community_place_id,
      'public_name', COALESCE(p.name, m.location_name),
      'category', COALESCE(p.category::text, 'venue'),
      'is_publicly_available', publicly_available,
      'is_fully_vegan', COALESCE(p.veggie_classification,'') = 'fully_vegan',
      'status_label', status_label,
      'member_message', member_message,
      'location_integrity_state', state,
      'snapshot_is_current', state IN ('current', 'temporarily_unavailable'),
      'public_place_route', CASE WHEN publicly_available THEN '/place/' || m.community_place_id::text ELSE NULL END,
      'directions_allowed', state NOT IN ('permanently_unavailable', 'place_hidden'),
      'member_has_supported_place', visits > 0,
      'member_verified_visit_count', visits
    ),
    'snapshot', jsonb_build_object(
      'location_name', m.location_name,
      'address', m.address,
      'neighborhood', m.neighborhood,
      'city_name', m.city_name_snapshot
    ),
    'host', host_block
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meetup_place_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meetup_place_context(uuid) TO authenticated;

-- 4. Host-only, explicit "update Meetup to the place's current location".
CREATE OR REPLACE FUNCTION public.accept_meetup_current_place_location(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; m RECORD; p RECORD; res jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.community_place_id IS NULL THEN
    RAISE EXCEPTION 'This Meetup is not hosted at a Community Place.';
  END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already been cancelled.';
  END IF;
  IF (m.date + COALESCE(m.end_time, m.start_time)) <= now() THEN
    RAISE EXCEPTION 'This Meetup has already ended.';
  END IF;

  SELECT * INTO p FROM public.community_places
   WHERE id = m.community_place_id
     AND is_active
     AND verification_status = 'verified'
     AND COALESCE(veggie_classification,'') = 'fully_vegan'
     AND COALESCE(maintenance_status,'operational') = 'operational'
     AND COALESCE(business_status,'OPERATIONAL') = 'OPERATIONAL';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That place is not available for hosting.';
  END IF;

  PERFORM set_config('app.meetup_resnapshot', 'on', true);
  res := public.update_meetup_location(
    _meetup_id, p.city_id, p.id, p.name, p.address, p.neighborhood,
    p.latitude, p.longitude, COALESCE(p.timezone, 'Asia/Ho_Chi_Minh'),
    'community_place'
  );
  PERFORM set_config('app.meetup_resnapshot', 'off', true);

  RETURN jsonb_build_object('ok', true, 'result', res);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_meetup_current_place_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_meetup_current_place_location(uuid) TO authenticated;