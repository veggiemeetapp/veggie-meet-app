CREATE OR REPLACE FUNCTION public.search_meetups(_query text, _city_id uuid DEFAULT NULL::uuid, _include_all_cities boolean DEFAULT false, _categories text[] DEFAULT NULL::text[], _date_from date DEFAULT NULL::date, _date_to date DEFAULT NULL::date, _availability text DEFAULT NULL::text, _attendance text DEFAULT NULL::text, _include_past boolean DEFAULT false, _limit integer DEFAULT 20, _cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
        -- starts sooner (days between meetup date and today, capped)
        + GREATEST(0, 90 - (f.date - CURRENT_DATE))::numeric
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
END $function$;