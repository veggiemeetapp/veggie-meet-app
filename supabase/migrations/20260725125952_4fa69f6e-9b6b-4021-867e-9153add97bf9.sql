
-- =============================================================
-- WO-033 Community Impact RPCs (derived; no schema changes)
-- =============================================================

-- Helper: legitimate hosted meetup ids for a profile.
-- Rules: host = profile, status <> 'cancelled', meetup has ended,
-- and at least one non-removed checked_in/attended participant (excluding host).
CREATE OR REPLACE FUNCTION public._legit_hosted_meetup_ids(_profile_id uuid)
RETURNS TABLE (meetup_id uuid, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id,
         (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))::timestamptz
    FROM public.meetups m
   WHERE m.host_id = _profile_id
     AND m.status <> 'cancelled'::meetup_status
     AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
     AND EXISTS (
       SELECT 1 FROM public.attendance a
        WHERE a.meetup_id = m.id
          AND a.profile_id <> _profile_id
          AND a.status::text IN ('checked_in','attended')
     );
$$;

-- Helper: legitimate place-support (unique place) for a profile.
-- Rules: attendance status in (checked_in, attended), meetup not cancelled,
-- meetup has ended, meetup linked to a valid community_place_id.
-- Returns each unique place with FIRST support timestamp and source meetup.
CREATE OR REPLACE FUNCTION public._legit_place_supports(_profile_id uuid)
RETURNS TABLE (community_place_id uuid, first_supported_at timestamptz, first_meetup_id uuid, last_supported_at timestamptz, visits int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- Helper: unique verified pairs involving a profile (block-aware peer id preserved,
-- caller decides how to render blocked peers; totals are historical and unchanged).
CREATE OR REPLACE FUNCTION public._legit_verified_pairs(_profile_id uuid)
RETURNS TABLE (peer_profile_id uuid, first_verified_at timestamptz, source_meetup_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE WHEN v.profile_a_id = _profile_id THEN v.profile_b_id ELSE v.profile_a_id END AS peer_profile_id,
    MIN(v.verified_at) AS first_verified_at,
    (ARRAY_AGG(v.meetup_id ORDER BY v.verified_at ASC))[1] AS source_meetup_id
  FROM public.verified_meetup_connections v
  WHERE v.profile_a_id = _profile_id OR v.profile_b_id = _profile_id
  GROUP BY 1;
$$;

-- Overview + recent activity for the signed-in user
CREATE OR REPLACE FUNCTION public.get_my_community_impact()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid;
  veggies_ct int;
  places_ct int;
  hosted_ct int;
  recent jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT count(*) INTO veggies_ct FROM public._legit_verified_pairs(me);
  SELECT count(*) INTO places_ct  FROM public._legit_place_supports(me);
  SELECT count(*) INTO hosted_ct  FROM public._legit_hosted_meetup_ids(me);

  WITH pairs AS (
    SELECT vp.peer_profile_id, vp.first_verified_at AS occurred_at, vp.source_meetup_id
      FROM public._legit_verified_pairs(me) vp
  ),
  places AS (
    SELECT ps.community_place_id, ps.first_supported_at AS occurred_at, ps.first_meetup_id
      FROM public._legit_place_supports(me) ps
  ),
  hosted AS (
    SELECT hm.meetup_id, hm.occurred_at
      FROM public._legit_hosted_meetup_ids(me) hm
  ),
  unified AS (
    SELECT 'verified_connection'::text AS activity_type,
           ('vc_' || peer_profile_id::text) AS id,
           occurred_at,
           peer_profile_id AS subject_profile_id,
           source_meetup_id AS subject_meetup_id,
           NULL::uuid AS subject_place_id
      FROM pairs
    UNION ALL
    SELECT 'place_supported',
           ('pl_' || community_place_id::text),
           occurred_at,
           NULL::uuid, first_meetup_id, community_place_id
      FROM places
    UNION ALL
    SELECT 'meetup_hosted',
           ('mh_' || meetup_id::text),
           occurred_at,
           NULL::uuid, meetup_id, NULL::uuid
      FROM hosted
  ),
  ordered AS (
    SELECT * FROM unified ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT 5
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb) INTO recent FROM ordered;

  RETURN jsonb_build_object(
    'veggies_met', veggies_ct,
    'community_places_supported', places_ct,
    'meetups_hosted', hosted_ct,
    'recent_activity', recent,
    'last_updated_at', now()
  );
END; $$;

-- Full paginated history (optional type filter)
CREATE OR REPLACE FUNCTION public.get_my_impact_history(
  _cursor timestamptz DEFAULT NULL,
  _cursor_id text DEFAULT NULL,
  _limit int DEFAULT 20,
  _type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid;
  page_size int := LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
  rows jsonb;
  next_cursor timestamptz;
  next_cursor_id text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  WITH pairs AS (
    SELECT vp.peer_profile_id, vp.first_verified_at AS occurred_at, vp.source_meetup_id
      FROM public._legit_verified_pairs(me) vp
     WHERE (_type IS NULL OR _type = 'verified_connection')
  ),
  places AS (
    SELECT ps.community_place_id, ps.first_supported_at AS occurred_at, ps.first_meetup_id
      FROM public._legit_place_supports(me) ps
     WHERE (_type IS NULL OR _type = 'place_supported')
  ),
  hosted AS (
    SELECT hm.meetup_id, hm.occurred_at
      FROM public._legit_hosted_meetup_ids(me) hm
     WHERE (_type IS NULL OR _type = 'meetup_hosted')
  ),
  unified AS (
    SELECT 'verified_connection'::text AS activity_type,
           ('vc_' || peer_profile_id::text) AS id,
           occurred_at,
           peer_profile_id AS subject_profile_id,
           source_meetup_id AS subject_meetup_id,
           NULL::uuid AS subject_place_id
      FROM pairs
    UNION ALL
    SELECT 'place_supported',
           ('pl_' || community_place_id::text),
           occurred_at, NULL::uuid, first_meetup_id, community_place_id
      FROM places
    UNION ALL
    SELECT 'meetup_hosted',
           ('mh_' || meetup_id::text),
           occurred_at, NULL::uuid, meetup_id, NULL::uuid
      FROM hosted
  ),
  filtered AS (
    SELECT * FROM unified
     WHERE _cursor IS NULL
        OR (occurred_at < _cursor)
        OR (occurred_at = _cursor AND id < COALESCE(_cursor_id, ''))
  ),
  page AS (
    SELECT * FROM filtered ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT page_size + 1
  ),
  page_bounded AS (
    SELECT * FROM page ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT page_size
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page_bounded)), '[]'::jsonb) INTO rows FROM page_bounded;

  SELECT occurred_at, id
    INTO next_cursor, next_cursor_id
    FROM (
      SELECT occurred_at, id, ROW_NUMBER() OVER (ORDER BY occurred_at DESC NULLS LAST, id DESC) AS rn
        FROM (
          WITH pairs2 AS (
            SELECT vp.peer_profile_id, vp.first_verified_at AS occurred_at, vp.source_meetup_id
              FROM public._legit_verified_pairs(me) vp
             WHERE (_type IS NULL OR _type = 'verified_connection')
          ),
          places2 AS (
            SELECT ps.community_place_id, ps.first_supported_at AS occurred_at, ps.first_meetup_id
              FROM public._legit_place_supports(me) ps
             WHERE (_type IS NULL OR _type = 'place_supported')
          ),
          hosted2 AS (
            SELECT hm.meetup_id, hm.occurred_at
              FROM public._legit_hosted_meetup_ids(me) hm
             WHERE (_type IS NULL OR _type = 'meetup_hosted')
          )
          SELECT occurred_at, ('vc_' || peer_profile_id::text) AS id FROM pairs2
          UNION ALL SELECT occurred_at, ('pl_' || community_place_id::text) FROM places2
          UNION ALL SELECT occurred_at, ('mh_' || meetup_id::text) FROM hosted2
        ) u
       WHERE _cursor IS NULL
          OR (occurred_at < _cursor)
          OR (occurred_at = _cursor AND id < COALESCE(_cursor_id, ''))
    ) ranked
   WHERE rn = page_size + 1;

  RETURN jsonb_build_object(
    'items', rows,
    'next_cursor', next_cursor,
    'next_cursor_id', next_cursor_id,
    'has_more', next_cursor IS NOT NULL
  );
END; $$;

-- Public totals only (for Veggie Profile summary). Block-aware.
CREATE OR REPLACE FUNCTION public.get_public_community_impact(_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid;
  veggies_ct int;
  places_ct int;
  hosted_ct int;
BEGIN
  IF _profile_id IS NULL THEN RAISE EXCEPTION 'profile required'; END IF;
  me := public.current_profile_id();
  IF me IS NOT NULL AND me <> _profile_id
     AND public.is_blocked_between(me, _profile_id) THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  SELECT count(*) INTO veggies_ct FROM public._legit_verified_pairs(_profile_id);
  SELECT count(*) INTO places_ct  FROM public._legit_place_supports(_profile_id);
  SELECT count(*) INTO hosted_ct  FROM public._legit_hosted_meetup_ids(_profile_id);

  RETURN jsonb_build_object(
    'available', true,
    'veggies_met', veggies_ct,
    'community_places_supported', places_ct,
    'meetups_hosted', hosted_ct
  );
END; $$;

GRANT EXECUTE ON FUNCTION public._legit_hosted_meetup_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._legit_place_supports(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._legit_verified_pairs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_community_impact() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_impact_history(timestamptz, text, int, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_community_impact(uuid) TO authenticated, anon, service_role;
