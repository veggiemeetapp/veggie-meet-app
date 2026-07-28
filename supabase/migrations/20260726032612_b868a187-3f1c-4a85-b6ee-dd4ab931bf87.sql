
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ------------------------------------------------------------------
-- Helper: normalize text for search matching (lower + unaccent).
-- Marked IMMUTABLE-safe wrapper via inner CALL; unaccent itself is
-- stable, so mark the wrapper STABLE.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_norm(_t text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT lower(public.unaccent(coalesce(_t, '')))
$$;

-- ------------------------------------------------------------------
-- search_veggies
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_veggies(
  _query text,
  _city_id uuid DEFAULT NULL,
  _include_all_cities boolean DEFAULT false,
  _interests text[] DEFAULT NULL,
  _relationship text[] DEFAULT NULL,  -- 'none' | 'pending' | 'connected' | 'verified'
  _limit int DEFAULT 20,
  _cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _me uuid;
  _me_city uuid;
  _q text := public.search_norm(_query);
  _limit_clamped int := LEAST(GREATEST(coalesce(_limit, 20), 1), 20);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
BEGIN
  SELECT p.id, p.home_city_id INTO _me, _me_city
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid();
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  IF _cursor IS NOT NULL AND position(':' IN _cursor) > 0 THEN
    _cur_score := split_part(_cursor, ':', 1)::numeric;
    _cur_id := split_part(_cursor, ':', 2)::uuid;
  END IF;

  WITH blocks AS (
    SELECT CASE WHEN b.blocker_profile_id = _me THEN b.blocked_profile_id ELSE b.blocker_profile_id END AS other_id
    FROM public.user_blocks b
    WHERE b.blocker_profile_id = _me OR b.blocked_profile_id = _me
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
  candidates AS (
    SELECT
      p.id,
      p.display_name,
      p.avatar_url,
      p.bio,
      p.interests,
      p.is_active_host,
      p.home_city_id,
      c.name AS city_name
    FROM public.profiles p
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE p.id <> _me
      AND p.auth_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.other_id = p.id)
      AND (
        _q = '' OR (
          public.search_norm(p.display_name) LIKE '%'||_q||'%'
          OR public.search_norm(p.bio) LIKE '%'||_q||'%'
          OR EXISTS (
            SELECT 1 FROM unnest(coalesce(p.interests,'{}')) AS i(v)
            WHERE public.search_norm(i.v) LIKE '%'||_q||'%'
          )
        )
      )
      AND (
        _include_all_cities
        OR _city_id IS NULL
        OR p.home_city_id = _city_id
      )
      AND (
        _interests IS NULL OR array_length(_interests,1) IS NULL OR
        p.interests && _interests
      )
  ),
  scored AS (
    SELECT
      c.*,
      (
        -- Exact / prefix name
        CASE WHEN _q <> '' AND public.search_norm(c.display_name) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(c.display_name) LIKE _q||'%' THEN 700
             ELSE 0 END
        -- Shared upcoming meetup
        + CASE WHEN EXISTS (
            SELECT 1 FROM public.attendance a
            JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
            WHERE a.profile_id = c.id AND a.status NOT IN ('cancelled','removed')
          ) THEN 400 ELSE 0 END
        -- Shared interests
        + LEAST(
            COALESCE(array_length(
              (SELECT array_agg(x) FROM unnest(c.interests) x
                WHERE EXISTS (
                  SELECT 1 FROM public.profiles me2
                  WHERE me2.id = _me AND lower(x) = ANY(SELECT lower(v) FROM unnest(coalesce(me2.interests,'{}')) v)
                )
              ), 1
            ), 0) * 40,
            120
          )
        -- Same selected city
        + CASE WHEN _city_id IS NOT NULL AND c.home_city_id = _city_id THEN 60 ELSE 0 END
        -- Bio match
        + CASE WHEN _q <> '' AND public.search_norm(c.bio) LIKE '%'||_q||'%' THEN 20 ELSE 0 END
      )::numeric AS score
    FROM candidates c
  ),
  rel AS (
    SELECT
      s.id AS other_id,
      f.id AS friendship_id,
      f.status,
      f.requester_id
    FROM scored s
    LEFT JOIN LATERAL (
      SELECT id, status, requester_id
      FROM public.friendships
      WHERE (profile_a_id = LEAST(_me, s.id) AND profile_b_id = GREATEST(_me, s.id))
      LIMIT 1
    ) f ON true
  ),
  ranked AS (
    SELECT
      s.*,
      COALESCE(r.status::text, 'none') AS rel_status,
      r.requester_id,
      r.friendship_id,
      (
        SELECT string_agg(t, ', ')
        FROM (
          SELECT x AS t
          FROM unnest(s.interests) x
          WHERE EXISTS (
            SELECT 1 FROM public.profiles me3
            WHERE me3.id = _me
              AND lower(x) = ANY(SELECT lower(v) FROM unnest(coalesce(me3.interests,'{}')) v)
          )
          LIMIT 2
        ) t
      ) AS shared_interests_label,
      (
        SELECT mu.title
        FROM public.attendance a
        JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
        WHERE a.profile_id = s.id AND a.status NOT IN ('cancelled','removed')
        LIMIT 1
      ) AS shared_meetup_title
    FROM scored s
    LEFT JOIN rel r ON r.other_id = s.id
    WHERE (
      _relationship IS NULL OR array_length(_relationship,1) IS NULL
      OR COALESCE(
          CASE WHEN r.status = 'pending' THEN 'pending'
               WHEN r.status IN ('connected','verified') THEN r.status::text
               ELSE 'none' END, 'none') = ANY(_relationship)
    )
    AND (
      _cur_score IS NULL OR (score, s.id) < (_cur_score, _cur_id)
    )
  )
  SELECT jsonb_agg(item ORDER BY score DESC, id ASC)
  INTO _items
  FROM (
    SELECT
      jsonb_build_object(
        'entity_type', 'veggie',
        'entity_id', ranked.id,
        'display_name', ranked.display_name,
        'avatar_url', ranked.avatar_url,
        'bio', ranked.bio,
        'city_name', ranked.city_name,
        'city_id', ranked.home_city_id,
        'is_active_host', ranked.is_active_host,
        'interests', to_jsonb(ranked.interests),
        'shared_interests_label', ranked.shared_interests_label,
        'shared_meetup_title', ranked.shared_meetup_title,
        'relationship', ranked.rel_status,
        'friendship_id', ranked.friendship_id,
        'requester_id', ranked.requester_id,
        'score', ranked.score,
        'cursor', ranked.score::text || ':' || ranked.id::text,
        'reason_code',
          CASE
            WHEN ranked.shared_meetup_title IS NOT NULL THEN 'shared_meetup'
            WHEN ranked.rel_status = 'connected' OR ranked.rel_status = 'verified' THEN 'connected'
            WHEN ranked.shared_interests_label IS NOT NULL THEN 'shared_interest'
            WHEN _city_id IS NOT NULL AND ranked.home_city_id = _city_id THEN 'same_city'
            ELSE 'match'
          END,
        'reason_label',
          CASE
            WHEN ranked.shared_meetup_title IS NOT NULL THEN 'Both going to '||ranked.shared_meetup_title
            WHEN ranked.rel_status = 'verified' THEN 'Verified connection'
            WHEN ranked.rel_status = 'connected' THEN 'Connected'
            WHEN ranked.shared_interests_label IS NOT NULL THEN 'Shares '||ranked.shared_interests_label
            WHEN _city_id IS NOT NULL AND ranked.home_city_id = _city_id THEN 'In your city'
            ELSE NULL
          END,
        'score_orig', ranked.score,
        'id', ranked.id
      ) AS item,
      ranked.score,
      ranked.id
    FROM ranked
    ORDER BY score DESC, id ASC
    LIMIT _limit_clamped
  ) top;

  _items := COALESCE(_items, '[]'::jsonb);

  IF jsonb_array_length(_items) = _limit_clamped THEN
    _next := (_items->-1->>'cursor');
  END IF;

  RETURN jsonb_build_object('items', _items, 'next_cursor', _next);
END $$;

GRANT EXECUTE ON FUNCTION public.search_veggies(text, uuid, boolean, text[], text[], int, text) TO authenticated;

-- ------------------------------------------------------------------
-- search_meetups
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_meetups(
  _query text,
  _city_id uuid DEFAULT NULL,
  _include_all_cities boolean DEFAULT false,
  _categories text[] DEFAULT NULL,
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _availability text DEFAULT NULL,           -- 'available' | 'full' | 'any'
  _attendance text DEFAULT NULL,             -- 'mine' | 'hosting' | 'any'
  _include_past boolean DEFAULT false,
  _limit int DEFAULT 20,
  _cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _me uuid;
  _q text := public.search_norm(_query);
  _limit_clamped int := LEAST(GREATEST(coalesce(_limit, 20), 1), 20);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
BEGIN
  SELECT p.id INTO _me FROM public.profiles p WHERE p.auth_user_id = auth.uid();
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  IF _cursor IS NOT NULL AND position(':' IN _cursor) > 0 THEN
    _cur_score := split_part(_cursor, ':', 1)::numeric;
    _cur_id := split_part(_cursor, ':', 2)::uuid;
  END IF;

  WITH blocks AS (
    SELECT CASE WHEN b.blocker_profile_id = _me THEN b.blocked_profile_id ELSE b.blocker_profile_id END AS other_id
    FROM public.user_blocks b
    WHERE b.blocker_profile_id = _me OR b.blocked_profile_id = _me
  ),
  base AS (
    SELECT
      m.*,
      cp.name AS place_name,
      h.display_name AS host_name,
      h.avatar_url AS host_avatar,
      (SELECT count(*)::int FROM public.attendance a
        WHERE a.meetup_id = m.id AND a.status NOT IN ('cancelled','removed')) AS attendee_count,
      EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.meetup_id = m.id AND a.profile_id = _me
          AND a.status NOT IN ('cancelled','removed')
      ) AS is_attending,
      (m.host_id = _me) AS is_host
    FROM public.meetups m
    LEFT JOIN public.community_places cp ON cp.id = m.community_place_id
    LEFT JOIN public.profiles h ON h.id = m.host_id
    WHERE
      NOT EXISTS (SELECT 1 FROM blocks b WHERE b.other_id = m.host_id)
      AND (_include_past OR m.date >= CURRENT_DATE)
      AND m.status <> 'cancelled'
      AND (_include_all_cities OR _city_id IS NULL OR m.city_id = _city_id)
      AND (_date_from IS NULL OR m.date >= _date_from)
      AND (_date_to IS NULL OR m.date <= _date_to)
      AND (_categories IS NULL OR array_length(_categories,1) IS NULL OR m.category::text = ANY(_categories))
      AND (
        _q = '' OR
        public.search_norm(m.title) LIKE '%'||_q||'%'
        OR public.search_norm(m.description) LIKE '%'||_q||'%'
        OR public.search_norm(m.category::text) LIKE '%'||_q||'%'
        OR public.search_norm(m.location_name) LIKE '%'||_q||'%'
        OR public.search_norm(m.custom_location_name) LIKE '%'||_q||'%'
        OR public.search_norm(m.neighborhood) LIKE '%'||_q||'%'
        OR public.search_norm(cp.name) LIKE '%'||_q||'%'
        OR public.search_norm(h.display_name) LIKE '%'||_q||'%'
      )
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (
      _availability IS NULL OR _availability = 'any'
      OR (_availability = 'available' AND b.attendee_count < b.capacity)
      OR (_availability = 'full' AND b.attendee_count >= b.capacity)
    )
    AND (
      _attendance IS NULL OR _attendance = 'any'
      OR (_attendance = 'mine' AND (b.is_attending OR b.is_host))
      OR (_attendance = 'hosting' AND b.is_host)
    )
  ),
  scored AS (
    SELECT
      f.*,
      (
        CASE WHEN _q <> '' AND public.search_norm(f.title) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(f.title) LIKE _q||'%' THEN 700
             ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(f.category::text) = _q THEN 300 ELSE 0 END
        + CASE WHEN _q <> '' AND (
              public.search_norm(f.location_name) LIKE '%'||_q||'%'
              OR public.search_norm(f.custom_location_name) LIKE '%'||_q||'%'
              OR public.search_norm(f.neighborhood) LIKE '%'||_q||'%'
              OR public.search_norm(f.place_name) LIKE '%'||_q||'%'
            ) THEN 200 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(f.description) LIKE '%'||_q||'%' THEN 80 ELSE 0 END
        + CASE WHEN f.is_attending OR f.is_host THEN 150 ELSE 0 END
        -- starts sooner
        + GREATEST(0, 90 - EXTRACT(EPOCH FROM (f.date - CURRENT_DATE))/86400)::numeric
        -- available capacity
        + CASE WHEN f.attendee_count < f.capacity THEN 10 ELSE 0 END
        -- final tie-breaker: attendance count (small weight only)
        + LEAST(f.attendee_count, 20) * 0.1
      )::numeric AS score
    FROM filtered f
  ),
  paged AS (
    SELECT * FROM scored
    WHERE (_cur_score IS NULL OR (score, id) < (_cur_score, _cur_id))
    ORDER BY score DESC, id ASC
    LIMIT _limit_clamped
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'entity_type', 'meetup',
      'entity_id', p.id,
      'title', p.title,
      'description', p.description,
      'category', p.category,
      'cover_image_url', p.cover_image_url,
      'date', p.date,
      'start_time', p.start_time,
      'end_time', p.end_time,
      'timezone', p.timezone,
      'capacity', p.capacity,
      'attendee_count', p.attendee_count,
      'city_id', p.city_id,
      'city_name', p.city_name_snapshot,
      'neighborhood', p.neighborhood,
      'location_name', COALESCE(p.location_name, p.custom_location_name, p.place_name),
      'address', COALESCE(p.address, p.custom_location_address),
      'host_id', p.host_id,
      'host_name', p.host_name,
      'host_avatar', p.host_avatar,
      'is_attending', p.is_attending,
      'is_host', p.is_host,
      'is_full', (p.attendee_count >= p.capacity),
      'reason_code',
        CASE
          WHEN p.is_host THEN 'hosting'
          WHEN p.is_attending THEN 'attending'
          WHEN _q <> '' AND public.search_norm(p.title) LIKE _q||'%' THEN 'title_match'
          WHEN _q <> '' AND public.search_norm(p.category::text) = _q THEN 'category_match'
          WHEN _q <> '' AND (public.search_norm(p.location_name) LIKE '%'||_q||'%' OR public.search_norm(p.neighborhood) LIKE '%'||_q||'%') THEN 'location_match'
          ELSE 'match'
        END,
      'reason_label',
        CASE
          WHEN p.is_host THEN 'You''re hosting'
          WHEN p.is_attending THEN 'You''re going'
          WHEN _q <> '' AND public.search_norm(p.category::text) = _q THEN 'Matches '||p.category
          WHEN p.neighborhood IS NOT NULL THEN 'In '||p.neighborhood
          WHEN p.city_name_snapshot IS NOT NULL THEN 'In '||p.city_name_snapshot
          ELSE NULL
        END,
      'cursor', p.score::text || ':' || p.id::text,
      'score', p.score
    ) ORDER BY p.score DESC, p.id ASC
  )
  INTO _items
  FROM paged p;

  _items := COALESCE(_items, '[]'::jsonb);
  IF jsonb_array_length(_items) = _limit_clamped THEN
    _next := (_items->-1->>'cursor');
  END IF;
  RETURN jsonb_build_object('items', _items, 'next_cursor', _next);
END $$;

GRANT EXECUTE ON FUNCTION public.search_meetups(text, uuid, boolean, text[], date, date, text, text, boolean, int, text) TO authenticated;

-- ------------------------------------------------------------------
-- search_community_places
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_community_places(
  _query text,
  _city_id uuid DEFAULT NULL,
  _include_all_cities boolean DEFAULT false,
  _categories text[] DEFAULT NULL,
  _neighborhood text DEFAULT NULL,
  _limit int DEFAULT 20,
  _cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _me uuid;
  _q text := public.search_norm(_query);
  _limit_clamped int := LEAST(GREATEST(coalesce(_limit, 20), 1), 20);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
BEGIN
  SELECT p.id INTO _me FROM public.profiles p WHERE p.auth_user_id = auth.uid();
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  IF _cursor IS NOT NULL AND position(':' IN _cursor) > 0 THEN
    _cur_score := split_part(_cursor, ':', 1)::numeric;
    _cur_id := split_part(_cursor, ':', 2)::uuid;
  END IF;

  WITH base AS (
    SELECT
      pl.*,
      c.name AS city_name
    FROM public.community_places pl
    LEFT JOIN public.cities c ON c.id = pl.city_id
    WHERE pl.is_active IS TRUE
      AND (_include_all_cities OR _city_id IS NULL OR pl.city_id = _city_id)
      AND (_categories IS NULL OR array_length(_categories,1) IS NULL OR pl.category::text = ANY(_categories))
      AND (_neighborhood IS NULL OR public.search_norm(pl.neighborhood) = public.search_norm(_neighborhood))
      AND (
        _q = '' OR
        public.search_norm(pl.name) LIKE '%'||_q||'%'
        OR public.search_norm(pl.category::text) LIKE '%'||_q||'%'
        OR public.search_norm(pl.address) LIKE '%'||_q||'%'
        OR public.search_norm(pl.neighborhood) LIKE '%'||_q||'%'
      )
  ),
  scored AS (
    SELECT
      b.*,
      (
        CASE WHEN _q <> '' AND public.search_norm(b.name) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(b.name) LIKE _q||'%' THEN 700
             ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(b.category::text) = _q THEN 300 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(b.neighborhood) LIKE '%'||_q||'%' THEN 100 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(b.address) LIKE '%'||_q||'%' THEN 40 ELSE 0 END
      )::numeric AS score
    FROM base b
  ),
  paged AS (
    SELECT * FROM scored
    WHERE (_cur_score IS NULL OR (score, id) < (_cur_score, _cur_id))
    ORDER BY score DESC, id ASC
    LIMIT _limit_clamped
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'entity_type', 'place',
      'entity_id', p.id,
      'name', p.name,
      'category', p.category,
      'address', p.address,
      'cover_image_url', p.cover_image_url,
      'city_id', p.city_id,
      'city_name', p.city_name,
      'neighborhood', p.neighborhood,
      'latitude', p.latitude,
      'longitude', p.longitude,
      'upcoming_meetups_count', p.upcoming_meetups_count,
      'reason_code',
        CASE
          WHEN _q <> '' AND public.search_norm(p.category::text) = _q THEN 'category_match'
          WHEN p.neighborhood IS NOT NULL THEN 'neighborhood'
          WHEN p.city_name IS NOT NULL THEN 'city'
          ELSE 'match'
        END,
      'reason_label',
        CASE
          WHEN p.neighborhood IS NOT NULL THEN 'In '||p.neighborhood
          WHEN p.city_name IS NOT NULL THEN 'In '||p.city_name
          ELSE NULL
        END,
      'cursor', p.score::text || ':' || p.id::text,
      'score', p.score
    ) ORDER BY p.score DESC, p.id ASC
  )
  INTO _items
  FROM paged p;

  _items := COALESCE(_items, '[]'::jsonb);
  IF jsonb_array_length(_items) = _limit_clamped THEN
    _next := (_items->-1->>'cursor');
  END IF;
  RETURN jsonb_build_object('items', _items, 'next_cursor', _next);
END $$;

GRANT EXECUTE ON FUNCTION public.search_community_places(text, uuid, boolean, text[], text, int, text) TO authenticated;

-- ------------------------------------------------------------------
-- search_all — preview across the three
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_all(
  _query text,
  _city_id uuid DEFAULT NULL,
  _include_all_cities boolean DEFAULT false,
  _limit_per_type int DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _n int := LEAST(GREATEST(coalesce(_limit_per_type, 3), 1), 5);
  _v jsonb;
  _m jsonb;
  _p jsonb;
BEGIN
  _v := public.search_veggies(_query, _city_id, _include_all_cities, NULL, NULL, _n, NULL);
  _m := public.search_meetups(_query, _city_id, _include_all_cities, NULL, NULL, NULL, NULL, NULL, false, _n, NULL);
  _p := public.search_community_places(_query, _city_id, _include_all_cities, NULL, NULL, _n, NULL);
  RETURN jsonb_build_object(
    'veggies', _v->'items',
    'meetups', _m->'items',
    'places', _p->'items'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.search_all(text, uuid, boolean, int) TO authenticated;
