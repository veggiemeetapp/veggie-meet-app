-- WO-046: Community Place verified visits
CREATE TABLE public.community_place_visits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now(),
  verification_method text NOT NULL DEFAULT 'device_location',
  verification_status text NOT NULL DEFAULT 'verified',
  distance_meters integer,
  location_accuracy_meters integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_place_visits_method_chk CHECK (verification_method IN ('device_location')),
  CONSTRAINT community_place_visits_status_chk CHECK (verification_status IN ('verified','rejected'))
);

GRANT SELECT ON public.community_place_visits TO authenticated;
GRANT ALL ON public.community_place_visits TO service_role;

ALTER TABLE public.community_place_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read own place visits"
  ON public.community_place_visits FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE INDEX cpv_profile_visited_idx ON public.community_place_visits (profile_id, visited_at DESC);
CREATE INDEX cpv_profile_place_idx ON public.community_place_visits (profile_id, community_place_id, visited_at DESC);
CREATE INDEX cpv_place_visited_idx ON public.community_place_visits (community_place_id, visited_at DESC);

-- Server-authoritative check-in
CREATE OR REPLACE FUNCTION public.check_in_to_community_place(
  _place_id uuid,
  _latitude double precision,
  _longitude double precision,
  _accuracy double precision
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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

  SELECT id, name, latitude, longitude, is_active, verification_status, business_status
    INTO p
    FROM public.community_places
   WHERE id = _place_id;

  IF NOT FOUND
     OR p.is_active IS NOT TRUE
     OR p.verification_status <> 'verified'
     OR (p.business_status IS NOT NULL AND p.business_status <> 'OPERATIONAL')
     OR p.latitude IS NULL OR p.longitude IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_unavailable');
  END IF;

  IF _accuracy IS NULL OR _accuracy > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'accuracy_too_low');
  END IF;

  -- great-circle distance in meters
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

REVOKE ALL ON FUNCTION public.check_in_to_community_place(uuid, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_to_community_place(uuid, double precision, double precision, double precision) TO authenticated;

-- Cooldown state for the UI
CREATE OR REPLACE FUNCTION public.get_my_place_check_in_state(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid;
  last_v timestamptz;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RETURN jsonb_build_object('checked_in', false);
  END IF;

  SELECT visited_at INTO last_v
    FROM public.community_place_visits
   WHERE profile_id = me
     AND community_place_id = _place_id
     AND verification_status = 'verified'
   ORDER BY visited_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'checked_in', last_v IS NOT NULL AND last_v > now() - INTERVAL '12 hours',
    'ever_visited', last_v IS NOT NULL,
    'cooldown_until', CASE WHEN last_v IS NULL THEN NULL ELSE last_v + INTERVAL '12 hours' END
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_my_place_check_in_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_place_check_in_state(uuid) TO authenticated;

-- Community Places Supported now includes verified place visits (distinct places)
CREATE OR REPLACE FUNCTION public._legit_place_supports(_profile_id uuid)
 RETURNS TABLE(community_place_id uuid, first_supported_at timestamp with time zone, first_meetup_id uuid, last_supported_at timestamp with time zone, visits integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH events AS (
    SELECT m.community_place_id,
           (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))::timestamptz AS occurred_at,
           m.id AS meetup_id
      FROM public.attendance a
      JOIN public.meetups m ON m.id = a.meetup_id
     WHERE a.profile_id = _profile_id
       AND a.status::text IN ('checked_in','attended')
       AND m.status <> 'cancelled'::meetup_status
       AND m.community_place_id IS NOT NULL
       AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
    UNION ALL
    SELECT v.community_place_id,
           v.visited_at AS occurred_at,
           NULL::uuid AS meetup_id
      FROM public.community_place_visits v
     WHERE v.profile_id = _profile_id
       AND v.verification_status = 'verified'
  ),
  ranked AS (
    SELECT community_place_id,
           occurred_at,
           meetup_id,
           ROW_NUMBER() OVER (PARTITION BY community_place_id ORDER BY occurred_at ASC, meetup_id ASC) AS rn_asc
      FROM events
  )
  SELECT g.community_place_id,
         g.first_supported_at,
         (SELECT meetup_id FROM ranked r WHERE r.community_place_id = g.community_place_id AND r.rn_asc = 1) AS first_meetup_id,
         g.last_supported_at,
         g.visits
    FROM (
      SELECT community_place_id,
             MIN(occurred_at) AS first_supported_at,
             MAX(occurred_at) AS last_supported_at,
             COUNT(*)::int    AS visits
        FROM events
       GROUP BY community_place_id
    ) g;
$function$;