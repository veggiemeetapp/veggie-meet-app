-- WO-075 DEF-075-02: get_meet_next_candidates only honoured feedback recorded
-- with surface = 'meet_next', but the only client path that records profile
-- feedback ("Hide this recommendation" / "See fewer like this" on Today) writes
-- surface = 'today'. A member who dismissed a person on Today still saw them in
-- Meet Next. Person-level feedback is now surface-agnostic.
CREATE OR REPLACE FUNCTION public.get_meet_next_candidates(_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      WHERE rf.profile_id = _me
        AND rf.entity_type = 'profile'
        AND rf.entity_id = p.id::text
        AND rf.feedback_type IN ('hide','see_fewer')
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
$fn$;

REVOKE ALL ON FUNCTION public.get_meet_next_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meet_next_candidates(integer) TO authenticated;