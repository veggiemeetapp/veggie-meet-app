-- WO-075: canonical discovery eligibility -------------------------------------
CREATE OR REPLACE FUNCTION public.discovery_eligible_profile_ids(
  _me uuid,
  _include_related boolean DEFAULT true
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id
  FROM public.profiles p
  WHERE _me IS NOT NULL
    AND p.id <> _me
    AND p.deleted_at IS NULL
    AND p.auth_user_id IS NOT NULL
    AND p.onboarding_completed IS TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_profile_id = _me AND ub.blocked_profile_id = p.id)
         OR (ub.blocker_profile_id = p.id AND ub.blocked_profile_id = _me)
    )
    AND (
      p.discovery_visible IS TRUE
      OR (
        _include_related
        AND EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status IN ('pending','connected','verified')
            AND f.profile_a_id = LEAST(_me, p.id)
            AND f.profile_b_id = GREATEST(_me, p.id)
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.discovery_eligible_profile_ids(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discovery_eligible_profile_ids(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.discovery_eligible_profile_ids(uuid, boolean) FROM authenticated;

-- WO-075: hardened member search ---------------------------------------------
CREATE OR REPLACE FUNCTION public.search_veggies(
  _query text,
  _city_id uuid DEFAULT NULL::uuid,
  _include_all_cities boolean DEFAULT false,
  _interests text[] DEFAULT NULL::text[],
  _relationship text[] DEFAULT NULL::text[],
  _limit integer DEFAULT 20,
  _cursor text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _me uuid;
  _q text := public.search_norm(left(coalesce(_query,''), 80));
  _limit_clamped int := LEAST(GREATEST(coalesce(_limit, 20), 1), 20);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
BEGIN
  SELECT p.id INTO _me
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL;
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

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
  candidates AS (
    SELECT
      p.id, p.display_name, p.avatar_url, p.bio, COALESCE(p.interests,'{}'::text[]) AS interests,
      p.is_active_host, p.home_city_id, p.dietary_identity,
      COALESCE(c.name, NULLIF(p.current_city, '')) AS city_name
    FROM public.profiles p
    JOIN public.discovery_eligible_profile_ids(_me, true) e ON e = p.id
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE (
        _q = '' OR (
          public.search_norm(p.display_name) LIKE '%'||_q||'%'
          OR public.search_norm(p.bio) LIKE '%'||_q||'%'
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(p.interests,'{}')) AS i(v) WHERE public.search_norm(i.v) LIKE '%'||_q||'%')
        )
      )
      AND (_include_all_cities OR _city_id IS NULL OR p.home_city_id = _city_id)
      AND (_interests IS NULL OR array_length(_interests,1) IS NULL OR p.interests && _interests)
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
      COALESCE(array_length(e.shared_interests, 1), 0) AS shared_interest_count,
      (
        CASE WHEN _q <> '' AND public.search_norm(e.display_name) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(e.display_name) LIKE _q||'%' THEN 700
             ELSE 0 END
        + CASE WHEN e.shared_meetup_title IS NOT NULL THEN 400 ELSE 0 END
        + LEAST(COALESCE(array_length(e.shared_interests, 1), 0) * 40, 120)
        + CASE WHEN _city_id IS NOT NULL AND e.home_city_id = _city_id THEN 60 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(e.bio) LIKE '%'||_q||'%' THEN 20 ELSE 0 END
      )::numeric AS score
    FROM enriched e
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
    WHERE (
      _relationship IS NULL OR array_length(_relationship,1) IS NULL
      OR COALESCE(CASE WHEN f.status = 'pending' THEN 'pending'
             WHEN f.status IN ('connected','verified') THEN f.status::text
             ELSE 'none' END, 'none') = ANY(_relationship)
    )
    AND (_cur_score IS NULL OR (s.score, s.id) < (_cur_score, _cur_id))
  )
  SELECT jsonb_agg(item ORDER BY score DESC, id ASC) INTO _items
  FROM (
    SELECT jsonb_build_object(
      'entity_type', 'veggie',
      'entity_id', ranked.id,
      'display_name', ranked.display_name,
      'avatar_url', ranked.avatar_url,
      'bio', ranked.bio,
      'interests', ranked.interests,
      'is_active_host', ranked.is_active_host,
      'dietary_identity', ranked.dietary_identity,
      'city_name', ranked.city_name,
      'city_id', ranked.home_city_id,
      'shared_interests_label', ranked.shared_interests_label,
      'shared_meetup_title', ranked.shared_meetup_title,
      'relationship', CASE WHEN ranked.rel_status IN ('pending','connected','verified')
                           THEN ranked.rel_status ELSE 'none' END,
      'friendship_id', ranked.friendship_id,
      'requester_id', ranked.requester_id,
      'reason_code', CASE
        WHEN ranked.shared_meetup_title IS NOT NULL THEN 'same_meetup'
        WHEN ranked.shared_interest_count > 0 THEN 'shared_interests'
        WHEN _city_id IS NOT NULL AND ranked.home_city_id = _city_id THEN 'in_your_city'
        ELSE 'name_match' END,
      'reason_label', CASE
        WHEN ranked.shared_meetup_title IS NOT NULL THEN 'Also going to ' || ranked.shared_meetup_title
        WHEN ranked.shared_interest_count > 1 THEN ranked.shared_interest_count::text || ' shared interests'
        WHEN ranked.shared_interest_count = 1 THEN 'Shares ' || ranked.shared_interests_label
        WHEN _city_id IS NOT NULL AND ranked.home_city_id = _city_id THEN 'In ' || COALESCE(ranked.city_name,'your city')
        ELSE NULL END
    ) AS item, ranked.score, ranked.id
    FROM ranked
    ORDER BY score DESC, id ASC
    LIMIT _limit_clamped
  ) sub;

  IF _items IS NULL OR jsonb_array_length(_items) < _limit_clamped THEN
    _next := NULL;
  ELSE
    SELECT (r.score)::text || ':' || (r.id)::text INTO _next
    FROM ranked r
    ORDER BY r.score DESC, r.id ASC
    OFFSET _limit_clamped - 1 LIMIT 1;
  END IF;

  RETURN jsonb_build_object('items', COALESCE(_items, '[]'::jsonb), 'next_cursor', _next);
END;
$function$;

REVOKE ALL ON FUNCTION public.search_veggies(text, uuid, boolean, text[], text[], integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_veggies(text, uuid, boolean, text[], text[], integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_veggies(text, uuid, boolean, text[], text[], integer, text) TO authenticated;

-- WO-075: server-side Meet Next ----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_meet_next_candidates(_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid;
  _my_city uuid;
  _n int := LEAST(GREATEST(COALESCE(_limit, 6), 1), 20);
  _items jsonb;
BEGIN
  SELECT p.id, p.home_city_id INTO _me, _my_city
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid() AND p.deleted_at IS NULL;
  IF _me IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH me AS (
    SELECT COALESCE(interests,'{}'::text[]) AS interests FROM public.profiles WHERE id = _me
  ),
  my_upcoming AS (
    SELECT a.meetup_id, m.title
    FROM public.attendance a
    JOIN public.meetups m ON m.id = a.meetup_id
    WHERE a.profile_id = _me
      AND a.status IN ('joined','checked_in','attended')
      AND m.status NOT IN ('cancelled','past')
      AND m.date >= CURRENT_DATE
  ),
  candidates AS (
    SELECT p.id, p.display_name, p.avatar_url, COALESCE(p.interests,'{}'::text[]) AS interests,
           p.is_active_host, p.home_city_id, p.dietary_identity,
           COALESCE(c.name, NULLIF(p.current_city,'')) AS city_name
    FROM public.profiles p
    JOIN public.discovery_eligible_profile_ids(_me, false) e ON e = p.id
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.profile_a_id = LEAST(_me, p.id) AND f.profile_b_id = GREATEST(_me, p.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.recommendation_feedback rf
      WHERE rf.profile_id = _me AND rf.surface = 'meet_next'
        AND rf.entity_type = 'profile' AND rf.entity_id = p.id::text
        AND rf.expires_at > now()
    )
  ),
  enriched AS (
    SELECT c.*,
      (SELECT array_agg(x) FROM unnest(c.interests) x
        WHERE lower(x) = ANY (SELECT lower(v) FROM me, unnest(me.interests) v)) AS shared_interests,
      (SELECT mu.title FROM public.attendance a
        JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
        WHERE a.profile_id = c.id AND a.status IN ('joined','checked_in','attended')
        LIMIT 1) AS shared_meetup_title,
      (_my_city IS NOT NULL AND c.home_city_id = _my_city) AS same_city
    FROM candidates c
  ),
  reasoned AS (
    SELECT e.*,
      COALESCE(array_length(e.shared_interests,1),0) AS shared_count,
      CASE
        WHEN e.shared_meetup_title IS NOT NULL THEN 'same_meetup'
        WHEN COALESCE(array_length(e.shared_interests,1),0) >= 2 THEN 'shared_interests'
        WHEN e.same_city AND e.is_active_host THEN 'active_host_in_city'
        WHEN e.same_city THEN 'in_your_city'
        WHEN COALESCE(array_length(e.shared_interests,1),0) = 1 THEN 'shared_interest'
        ELSE NULL
      END AS reason_code
    FROM enriched e
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, id ASC), '[]'::jsonb) INTO _items
  FROM (
    SELECT r.id, 
      (CASE r.reason_code
         WHEN 'same_meetup' THEN 100
         WHEN 'shared_interests' THEN 60 + r.shared_count
         WHEN 'active_host_in_city' THEN 50
         WHEN 'in_your_city' THEN 30
         ELSE 15 END) AS score,
      jsonb_build_object(
        'profile_id', r.id,
        'display_name', r.display_name,
        'avatar_url', r.avatar_url,
        'city_name', r.city_name,
        'interests', to_jsonb(r.interests),
        'shared_interests', to_jsonb(COALESCE(r.shared_interests,'{}'::text[])),
        'dietary_identity', r.dietary_identity,
        'is_active_host', r.is_active_host,
        'reason_code', r.reason_code,
        'reason_label', CASE r.reason_code
          WHEN 'same_meetup' THEN 'Attending ' || r.shared_meetup_title
          WHEN 'shared_interests' THEN r.shared_count::text || ' shared interests'
          WHEN 'active_host_in_city' THEN 'Active Host in ' || COALESCE(r.city_name,'your city')
          WHEN 'in_your_city' THEN 'Also in ' || COALESCE(r.city_name,'your city')
          ELSE 'Also interested in ' || COALESCE((r.shared_interests)[1],'the same things')
        END
      ) AS row_json
    FROM reasoned r
    WHERE r.reason_code IS NOT NULL
    ORDER BY score DESC, r.id ASC
    LIMIT _n
  ) t;

  RETURN COALESCE(_items, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_meet_next_candidates(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meet_next_candidates(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meet_next_candidates(integer) TO authenticated;
