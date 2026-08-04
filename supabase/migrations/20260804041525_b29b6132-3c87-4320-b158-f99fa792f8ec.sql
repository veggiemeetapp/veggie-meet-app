-- 1) Status columns on published places
ALTER TABLE public.community_places
  ADD COLUMN IF NOT EXISTS maintenance_status text NOT NULL DEFAULT 'operational',
  ADD COLUMN IF NOT EXISTS status_note text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS last_reverified_at timestamptz;

ALTER TABLE public.community_places
  DROP CONSTRAINT IF EXISTS community_places_maintenance_status_check;
ALTER TABLE public.community_places
  ADD CONSTRAINT community_places_maintenance_status_check
  CHECK (maintenance_status IN ('operational','needs_reverification','temporarily_closed','permanently_closed'));

-- 2) Status history (owner-only read; writes only via SECURITY DEFINER RPCs)
CREATE TABLE IF NOT EXISTS public.community_place_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  old_is_active boolean,
  new_is_active boolean,
  action text NOT NULL,
  note text,
  changed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.community_place_status_history TO authenticated;
GRANT ALL ON public.community_place_status_history TO service_role;

ALTER TABLE public.community_place_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads place status history" ON public.community_place_status_history;
CREATE POLICY "Owner reads place status history"
  ON public.community_place_status_history FOR SELECT TO authenticated
  USING (public.is_owner());

CREATE INDEX IF NOT EXISTS community_place_status_history_place_idx
  ON public.community_place_status_history (community_place_id, created_at DESC);

-- 3) Owner-only: change a published place's status
CREATE OR REPLACE FUNCTION public.set_community_place_status(
  _place_id uuid,
  _status text,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid;
  p RECORD;
  new_active boolean;
  clean_note text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  IF _status IS NULL OR _status NOT IN
     ('operational','needs_reverification','temporarily_closed','permanently_closed') THEN
    RAISE EXCEPTION 'Unknown status.';
  END IF;

  clean_note := nullif(btrim(coalesce(_note, '')), '');
  IF clean_note IS NOT NULL AND length(clean_note) > 500 THEN
    RAISE EXCEPTION 'Status note must be 500 characters or fewer.';
  END IF;
  IF _status <> 'operational' AND clean_note IS NULL THEN
    RAISE EXCEPTION 'A reason note is required for this status.';
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  new_active := (_status <> 'permanently_closed');

  UPDATE public.community_places
     SET maintenance_status = _status,
         status_note        = clean_note,
         status_changed_at  = now(),
         status_changed_by  = me,
         is_active          = new_active,
         updated_at         = now()
   WHERE id = _place_id;

  INSERT INTO public.community_place_status_history (
    community_place_id, old_status, new_status, old_is_active, new_is_active,
    action, note, changed_by
  ) VALUES (
    _place_id, p.maintenance_status, _status, p.is_active, new_active,
    'status_changed', clean_note, me
  );

  RETURN jsonb_build_object(
    'ok', true,
    'place_id', _place_id,
    'maintenance_status', _status,
    'is_active', new_active,
    'status_changed_at', now()
  );
END; $$;

REVOKE ALL ON FUNCTION public.set_community_place_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_community_place_status(uuid, text, text) TO authenticated;

-- 4) Owner-only: record a completed vegan reverification
CREATE OR REPLACE FUNCTION public.reverify_community_place(
  _place_id uuid,
  _note text DEFAULT NULL,
  _veggie_classification text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid;
  p RECORD;
  clean_note text;
  new_class text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  clean_note := nullif(btrim(coalesce(_note, '')), '');
  IF clean_note IS NULL THEN
    RAISE EXCEPTION 'A reverification note is required.';
  END IF;
  IF length(clean_note) > 500 THEN
    RAISE EXCEPTION 'Reverification note must be 500 characters or fewer.';
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  new_class := coalesce(nullif(btrim(coalesce(_veggie_classification, '')), ''), p.veggie_classification);
  IF new_class IS NOT NULL AND new_class NOT IN
     ('fully_vegan','fully_vegetarian','vegetarian_friendly','vegan_options','not_food') THEN
    RAISE EXCEPTION 'Unknown vegan classification.';
  END IF;

  UPDATE public.community_places
     SET maintenance_status    = 'operational',
         status_note           = NULL,
         status_changed_at     = now(),
         status_changed_by     = me,
         last_reverified_at    = now(),
         verification_status   = 'verified',
         verified_at           = now(),
         verified_by           = me,
         veggie_classification = new_class,
         is_active             = true,
         updated_at            = now()
   WHERE id = _place_id;

  INSERT INTO public.community_place_status_history (
    community_place_id, old_status, new_status, old_is_active, new_is_active,
    action, note, changed_by
  ) VALUES (
    _place_id, p.maintenance_status, 'operational', p.is_active, true,
    'reverified', clean_note, me
  );

  RETURN jsonb_build_object('ok', true, 'place_id', _place_id, 'reverified_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.reverify_community_place(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverify_community_place(uuid, text, text) TO authenticated;

-- 5) Owner-only: maintenance list
CREATE OR REPLACE FUNCTION public.get_community_place_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE items jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
    INTO items
  FROM (
    SELECT p.id,
           p.name,
           p.address,
           p.category::text AS category,
           p.neighborhood,
           p.veggie_classification,
           p.maintenance_status,
           p.status_note,
           p.status_changed_at,
           p.last_reverified_at,
           p.verification_status,
           p.business_status,
           p.is_active,
           p.google_maps_url,
           (SELECT count(*)::int FROM public.meetups m
             WHERE m.community_place_id = p.id
               AND m.status <> 'cancelled'::meetup_status
               AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) > now()
           ) AS upcoming_meetups_here
      FROM public.community_places p
  ) t;

  RETURN jsonb_build_object('places', items);
END; $$;

REVOKE ALL ON FUNCTION public.get_community_place_maintenance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_place_maintenance() TO authenticated;

-- 6) Owner-only: status history for one place
CREATE OR REPLACE FUNCTION public.get_community_place_status_history(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE items jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO items
  FROM (
    SELECT h.id, h.old_status, h.new_status, h.old_is_active, h.new_is_active,
           h.action, h.note, h.created_at
      FROM public.community_place_status_history h
     WHERE h.community_place_id = _place_id
     ORDER BY h.created_at DESC
     LIMIT 50
  ) t;

  RETURN jsonb_build_object('entries', items);
END; $$;

REVOKE ALL ON FUNCTION public.get_community_place_status_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_place_status_history(uuid) TO authenticated;

-- 7) Enforcement: hosting a meetup at a place requires an operational place
CREATE OR REPLACE FUNCTION public.enforce_meetup_community_place()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cp RECORD;
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
  IF cp.verification_status <> 'verified'
     OR cp.is_active IS NOT TRUE
     OR COALESCE(cp.maintenance_status, 'operational') <> 'operational'
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
  RETURN NEW;
END;
$$;

-- 8) Enforcement: check-in requires an operational place
CREATE OR REPLACE FUNCTION public.check_in_to_community_place(
  _place_id uuid, _latitude double precision, _longitude double precision, _accuracy double precision
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  IF _latitude IS NULL OR _longitude IS NULL THEN
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

  IF _accuracy IS NULL OR _accuracy > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'accuracy_too_low');
  END IF;

  dist := 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(_latitude - p.latitude) / 2), 2)
      + cos(radians(p.latitude)) * cos(radians(_latitude))
      * power(sin(radians(_longitude - p.longitude) / 2), 2)
    )
  );

  IF dist > 150 THEN
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
END; $$;
