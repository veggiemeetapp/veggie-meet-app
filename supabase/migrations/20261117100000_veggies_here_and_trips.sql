-- ============================================================================
-- Veggies here + Upcoming trips (2026-11-17)
--
-- 1. profile_trips — a member says "I'll be in <city> from <start> to <end>".
--    Trips are private rows managed only through the SECURITY DEFINER RPCs
--    below; nothing is granted to anon/authenticated on the table itself.
--
-- 2. get_veggies_here(_city_id, …) — the full, filterable list of members who
--    are in a city on a given day: members whose Home City is the city, plus
--    members with a trip covering that day. Same eligibility rules as search
--    (discovery_eligible_profile_ids: not deleted, onboarded, discovery
--    visible or already related, no block in either direction). Cursor
--    pagination mirrors search_veggies.
--
-- 3. get_trip_overlaps(_trip_id, …) — who will be in that city while I am.
--
-- Nothing here changes existing functions, tables or policies.
-- ============================================================================

-- ---------------------------------------------------------------- 1. table
CREATE TABLE IF NOT EXISTS public.profile_trips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  city_id     uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_trips_dates_chk CHECK (end_date >= start_date),
  CONSTRAINT profile_trips_length_chk CHECK (end_date - start_date <= 180),
  CONSTRAINT profile_trips_note_chk CHECK (note IS NULL OR length(note) <= 140)
);

CREATE INDEX IF NOT EXISTS profile_trips_city_dates_idx
  ON public.profile_trips (city_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS profile_trips_profile_idx
  ON public.profile_trips (profile_id, start_date);

REVOKE ALL ON public.profile_trips FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.profile_trips TO service_role;
ALTER TABLE public.profile_trips ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS profile_trips_updated_at ON public.profile_trips;
CREATE TRIGGER profile_trips_updated_at
  BEFORE UPDATE ON public.profile_trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------- 2. shared presence query
-- Members present in a city during [_from, _to], as the caller may see them.
-- presence = 'lives_here' (Home City) or 'visiting' (trip overlapping window).
CREATE OR REPLACE FUNCTION public.veggies_present_in_city(
  _me uuid,
  _city_id uuid,
  _from date,
  _to date
)
RETURNS TABLE (
  profile_id uuid,
  presence text,
  visit_start date,
  visit_end date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT e AS id FROM public.discovery_eligible_profile_ids(_me, true) e
  ),
  residents AS (
    SELECT p.id AS profile_id, 'lives_here'::text AS presence,
           NULL::date AS visit_start, NULL::date AS visit_end
    FROM public.profiles p
    JOIN eligible e ON e.id = p.id
    WHERE p.home_city_id = _city_id
  ),
  visitors AS (
    SELECT DISTINCT ON (t.profile_id)
           t.profile_id, 'visiting'::text AS presence, t.start_date, t.end_date
    FROM public.profile_trips t
    JOIN eligible e ON e.id = t.profile_id
    JOIN public.profiles p ON p.id = t.profile_id
    WHERE t.city_id = _city_id
      AND t.start_date <= _to
      AND t.end_date >= _from
      AND (p.home_city_id IS DISTINCT FROM _city_id)
    ORDER BY t.profile_id, t.start_date
  )
  SELECT * FROM residents
  UNION ALL
  SELECT * FROM visitors;
$$;
REVOKE ALL ON FUNCTION public.veggies_present_in_city(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;

-- Shared row builder so get_veggies_here and get_trip_overlaps return the
-- same item shape as search_veggies (VeggieResult on the client) plus presence.
CREATE OR REPLACE FUNCTION public.veggies_in_city_page(
  _me uuid,
  _city_id uuid,
  _from date,
  _to date,
  _dietary text[],
  _hosts_only boolean,
  _shared_only boolean,
  _visiting_only boolean,
  _limit integer,
  _cursor text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _limit_clamped int := LEAST(GREATEST(COALESCE(_limit, 20), 1), 30);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
  _total int;
BEGIN
  IF _cursor IS NOT NULL AND position(':' IN _cursor) > 0 THEN
    _cur_score := split_part(_cursor, ':', 1)::numeric;
    _cur_id := split_part(_cursor, ':', 2)::uuid;
  END IF;

  WITH me AS (
    SELECT COALESCE(interests, '{}'::text[]) AS interests FROM public.profiles WHERE id = _me
  ),
  my_upcoming AS (
    SELECT a.meetup_id, m.title
    FROM public.attendance a
    JOIN public.meetups m ON m.id = a.meetup_id
    WHERE a.profile_id = _me
      AND a.status NOT IN ('cancelled','removed')
      AND m.date >= CURRENT_DATE
      AND m.status <> 'cancelled'
  ),
  present AS (
    SELECT * FROM public.veggies_present_in_city(_me, _city_id, _from, _to)
  ),
  candidates AS (
    SELECT
      p.id, p.display_name, p.avatar_url, p.bio, COALESCE(p.interests,'{}'::text[]) AS interests,
      p.is_active_host, p.home_city_id, p.dietary_identity,
      COALESCE(c.name, NULLIF(p.current_city, '')) AS city_name,
      pr.presence, pr.visit_start, pr.visit_end
    FROM present pr
    JOIN public.profiles p ON p.id = pr.profile_id
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE (_dietary IS NULL OR array_length(_dietary,1) IS NULL OR p.dietary_identity = ANY(_dietary))
      AND (NOT _hosts_only OR p.is_active_host IS TRUE)
      AND (NOT _visiting_only OR pr.presence = 'visiting')
  ),
  enriched AS (
    SELECT c.*,
      (SELECT array_agg(x) FROM unnest(c.interests) x
        WHERE lower(x) = ANY (SELECT lower(v) FROM me, unnest(me.interests) v)) AS shared_interests,
      (SELECT mu.title FROM public.attendance a
        JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
        WHERE a.profile_id = c.id AND a.status NOT IN ('cancelled','removed')
        LIMIT 1) AS shared_meetup_title
    FROM candidates c
  ),
  scored AS (
    SELECT e.*,
      COALESCE(array_length(e.shared_interests, 1), 0) AS shared_count,
      (
        CASE WHEN e.shared_meetup_title IS NOT NULL THEN 400 ELSE 0 END
        + LEAST(COALESCE(array_length(e.shared_interests, 1), 0) * 40, 120)
        + CASE WHEN e.presence = 'visiting' THEN 80 ELSE 0 END
        + CASE WHEN e.is_active_host THEN 30 ELSE 0 END
      )::numeric AS score
    FROM enriched e
    WHERE (NOT _shared_only OR COALESCE(array_length(e.shared_interests,1),0) > 0)
  ),
  ranked AS (
    SELECT s.*,
      COALESCE(f.status::text, 'none') AS rel_status,
      f.requester_id, f.id AS friendship_id,
      (SELECT string_agg(t, ', ') FROM (
        SELECT x AS t FROM unnest(COALESCE(s.shared_interests,'{}'::text[])) x LIMIT 2
      ) t) AS shared_interests_label
    FROM scored s
    LEFT JOIN LATERAL (
      SELECT id, status, requester_id FROM public.friendships
      WHERE profile_a_id = LEAST(_me, s.id) AND profile_b_id = GREATEST(_me, s.id)
      LIMIT 1
    ) f ON true
  )
  SELECT
    (SELECT count(*) FROM ranked),
    (SELECT jsonb_agg(item ORDER BY score DESC, id ASC) FROM (
      SELECT jsonb_build_object(
        'entity_type', 'veggie',
        'entity_id', r.id,
        'display_name', r.display_name,
        'avatar_url', r.avatar_url,
        'bio', r.bio,
        'interests', to_jsonb(r.interests),
        'is_active_host', r.is_active_host,
        'dietary_identity', r.dietary_identity,
        'city_name', r.city_name,
        'city_id', r.home_city_id,
        'presence', r.presence,
        'visit_start', r.visit_start,
        'visit_end', r.visit_end,
        'shared_interests_label', r.shared_interests_label,
        'shared_meetup_title', r.shared_meetup_title,
        'relationship', CASE WHEN r.rel_status IN ('pending','connected','verified')
                             THEN r.rel_status ELSE 'none' END,
        'friendship_id', r.friendship_id,
        'requester_id', r.requester_id,
        'reason_code', CASE
          WHEN r.shared_meetup_title IS NOT NULL THEN 'same_meetup'
          WHEN r.shared_count > 0 THEN 'shared_interests'
          WHEN r.presence = 'visiting' THEN 'visiting'
          ELSE 'in_your_city' END,
        'reason_label', CASE
          WHEN r.shared_meetup_title IS NOT NULL THEN 'Also going to ' || r.shared_meetup_title
          WHEN r.shared_count > 1 THEN r.shared_count::text || ' shared interests'
          WHEN r.shared_count = 1 THEN 'Shares ' || r.shared_interests_label
          WHEN r.presence = 'visiting' THEN 'Visiting until ' || to_char(r.visit_end, 'DD Mon')
          ELSE NULL END,
        'cursor', r.score::text || ':' || r.id::text
      ) AS item, r.score, r.id
      FROM ranked r
      WHERE _cur_score IS NULL
         OR r.score < _cur_score
         OR (r.score = _cur_score AND r.id > _cur_id)
      ORDER BY r.score DESC, r.id ASC
      LIMIT _limit_clamped
    ) sub)
  INTO _total, _items;

  IF _items IS NULL OR jsonb_array_length(_items) < _limit_clamped THEN
    _next := NULL;
  ELSE
    _next := _items -> (jsonb_array_length(_items) - 1) ->> 'cursor';
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(_items, '[]'::jsonb),
    'next_cursor', _next,
    'total', COALESCE(_total, 0)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.veggies_in_city_page(uuid, uuid, date, date, text[], boolean, boolean, boolean, integer, text) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------- 3. member-facing RPCs
-- Who is in a city today (city-local date).
CREATE OR REPLACE FUNCTION public.get_veggies_here(
  _city_id uuid,
  _dietary text[] DEFAULT NULL,
  _hosts_only boolean DEFAULT false,
  _shared_only boolean DEFAULT false,
  _visiting_only boolean DEFAULT false,
  _limit integer DEFAULT 20,
  _cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _me uuid;
  _today date;
BEGIN
  SELECT p.id INTO _me FROM public.profiles p
  WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL;
  IF _me IS NULL OR _city_id IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL, 'total', 0);
  END IF;

  SELECT (now() AT TIME ZONE c.timezone)::date INTO _today
  FROM public.cities c WHERE c.id = _city_id AND c.is_active;
  IF _today IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL, 'total', 0);
  END IF;

  RETURN public.veggies_in_city_page(
    _me, _city_id, _today, _today,
    _dietary, COALESCE(_hosts_only,false), COALESCE(_shared_only,false), COALESCE(_visiting_only,false),
    _limit, _cursor
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_veggies_here(uuid, text[], boolean, boolean, boolean, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_veggies_here(uuid, text[], boolean, boolean, boolean, integer, text) TO authenticated;

-- My upcoming and current trips (end date today or later), newest first.
CREATE OR REPLACE FUNCTION public.list_my_trips()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'city_id', t.city_id,
      'city_name', c.name,
      'country_code', c.country_code,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'note', t.note,
      'is_current', (now() AT TIME ZONE c.timezone)::date BETWEEN t.start_date AND t.end_date,
      'overlap_count', (
        SELECT count(*) FROM public.veggies_present_in_city((SELECT id FROM me), t.city_id, t.start_date, t.end_date)
      )
    ) ORDER BY t.start_date ASC), '[]'::jsonb)
  FROM public.profile_trips t
  JOIN public.cities c ON c.id = t.city_id
  WHERE t.profile_id = (SELECT id FROM me)
    AND t.end_date >= (now() AT TIME ZONE c.timezone)::date - 1;
$$;
REVOKE ALL ON FUNCTION public.list_my_trips() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_trips() TO authenticated;

-- Create or edit one of my trips. Returns the trip id.
CREATE OR REPLACE FUNCTION public.upsert_my_trip(
  _city_id uuid,
  _start_date date,
  _end_date date,
  _note text DEFAULT NULL,
  _trip_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _me uuid;
  _home uuid;
  _active boolean;
  _id uuid;
  _n int;
  _clean_note text := NULLIF(btrim(COALESCE(_note,'')), '');
BEGIN
  SELECT p.id, p.home_city_id INTO _me, _home FROM public.profiles p
  WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL;
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT is_active INTO _active FROM public.cities WHERE id = _city_id;
  IF NOT COALESCE(_active, false) THEN RAISE EXCEPTION 'Choose a city VeggieMeet is live in.'; END IF;
  IF _city_id = _home THEN RAISE EXCEPTION 'That is already your Home City.'; END IF;
  IF _start_date IS NULL OR _end_date IS NULL THEN RAISE EXCEPTION 'Choose your travel dates.'; END IF;
  IF _end_date < _start_date THEN RAISE EXCEPTION 'The end date must be after the start date.'; END IF;
  IF _end_date < CURRENT_DATE - 1 THEN RAISE EXCEPTION 'Those dates are already in the past.'; END IF;
  IF _end_date - _start_date > 180 THEN RAISE EXCEPTION 'A trip can be at most 180 days.'; END IF;
  IF _start_date > CURRENT_DATE + 365 THEN RAISE EXCEPTION 'Trips can be added up to a year ahead.'; END IF;
  IF length(COALESCE(_clean_note,'')) > 140 THEN RAISE EXCEPTION 'Keep the note under 140 characters.'; END IF;

  -- No overlapping trip to the same city (other than the one being edited).
  IF EXISTS (
    SELECT 1 FROM public.profile_trips t
    WHERE t.profile_id = _me AND t.city_id = _city_id
      AND (_trip_id IS NULL OR t.id <> _trip_id)
      AND t.start_date <= _end_date AND t.end_date >= _start_date
  ) THEN
    RAISE EXCEPTION 'You already have a trip to that city on those dates.';
  END IF;

  IF _trip_id IS NOT NULL THEN
    UPDATE public.profile_trips
       SET city_id = _city_id, start_date = _start_date, end_date = _end_date, note = _clean_note
     WHERE id = _trip_id AND profile_id = _me
     RETURNING id INTO _id;
    IF _id IS NULL THEN RAISE EXCEPTION 'Trip not found.'; END IF;
    RETURN _id;
  END IF;

  SELECT count(*) INTO _n FROM public.profile_trips t
  WHERE t.profile_id = _me AND t.end_date >= CURRENT_DATE;
  IF _n >= 10 THEN RAISE EXCEPTION 'You can keep up to 10 upcoming trips.'; END IF;

  INSERT INTO public.profile_trips (profile_id, city_id, start_date, end_date, note)
  VALUES (_me, _city_id, _start_date, _end_date, _clean_note)
  RETURNING id INTO _id;
  RETURN _id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.upsert_my_trip(uuid, date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_my_trip(uuid, date, date, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_trip(_trip_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _me uuid;
BEGIN
  SELECT p.id INTO _me FROM public.profiles p
  WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL;
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.profile_trips WHERE id = _trip_id AND profile_id = _me;
END;
$fn$;
REVOKE ALL ON FUNCTION public.delete_my_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_trip(uuid) TO authenticated;

-- Who will be in the city during one of my trips.
CREATE OR REPLACE FUNCTION public.get_trip_overlaps(
  _trip_id uuid,
  _dietary text[] DEFAULT NULL,
  _hosts_only boolean DEFAULT false,
  _shared_only boolean DEFAULT false,
  _visiting_only boolean DEFAULT false,
  _limit integer DEFAULT 20,
  _cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _me uuid;
  t public.profile_trips;
BEGIN
  SELECT p.id INTO _me FROM public.profiles p
  WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL;
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL, 'total', 0);
  END IF;
  SELECT * INTO t FROM public.profile_trips WHERE id = _trip_id AND profile_id = _me;
  IF t.id IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL, 'total', 0);
  END IF;
  RETURN public.veggies_in_city_page(
    _me, t.city_id, t.start_date, t.end_date,
    _dietary, COALESCE(_hosts_only,false), COALESCE(_shared_only,false), COALESCE(_visiting_only,false),
    _limit, _cursor
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_trip_overlaps(uuid, text[], boolean, boolean, boolean, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_overlaps(uuid, text[], boolean, boolean, boolean, integer, text) TO authenticated;
