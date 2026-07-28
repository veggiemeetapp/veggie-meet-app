
CREATE OR REPLACE FUNCTION public.get_my_impact_history(_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, _cursor_id text DEFAULT NULL::text, _limit integer DEFAULT 20, _type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  page_size int := LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
  rows jsonb;
  last_ts timestamptz;
  last_id text;
  has_more_flag boolean := false;
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
    SELECT *, ROW_NUMBER() OVER (ORDER BY occurred_at DESC NULLS LAST, id DESC) AS rn
      FROM filtered
     ORDER BY occurred_at DESC NULLS LAST, id DESC
     LIMIT page_size + 1
  ),
  returned AS (
    SELECT activity_type, id, occurred_at, subject_profile_id, subject_meetup_id, subject_place_id, rn
      FROM page WHERE rn <= page_size
      ORDER BY occurred_at DESC NULLS LAST, id DESC
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(r) - 'rn'), '[]'::jsonb),
    (SELECT max(rn) FROM page) > page_size,
    (SELECT occurred_at FROM returned ORDER BY rn DESC LIMIT 1),
    (SELECT id FROM returned ORDER BY rn DESC LIMIT 1)
  INTO rows, has_more_flag, last_ts, last_id
  FROM returned r;

  RETURN jsonb_build_object(
    'items', rows,
    'next_cursor', CASE WHEN has_more_flag THEN last_ts ELSE NULL END,
    'next_cursor_id', CASE WHEN has_more_flag THEN last_id ELSE NULL END,
    'has_more', has_more_flag
  );
END; $function$;
