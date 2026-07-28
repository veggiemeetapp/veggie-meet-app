
CREATE OR REPLACE FUNCTION public.search_veggies(_query text, _city_id uuid DEFAULT NULL::uuid, _include_all_cities boolean DEFAULT false, _interests text[] DEFAULT NULL::text[], _relationship text[] DEFAULT NULL::text[], _limit integer DEFAULT 20, _cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
      COALESCE(c.name, NULLIF(p.current_city, '')) AS city_name
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
        CASE WHEN _q <> '' AND public.search_norm(c.display_name) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(c.display_name) LIKE _q||'%' THEN 700
             ELSE 0 END
        + CASE WHEN EXISTS (
            SELECT 1 FROM public.attendance a
            JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
            WHERE a.profile_id = c.id AND a.status NOT IN ('cancelled','removed')
          ) THEN 400 ELSE 0 END
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
        + CASE WHEN _city_id IS NOT NULL AND c.home_city_id = _city_id THEN 60 ELSE 0 END
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
END $function$;
