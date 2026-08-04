CREATE OR REPLACE FUNCTION public.get_my_supported_places()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  items jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RETURN jsonb_build_object('places', '[]'::jsonb, 'distinct_supported', 0, 'direct_visits_total', 0);
  END IF;

  WITH supports AS (
    SELECT * FROM public._legit_place_supports(me)
  ),
  direct AS (
    SELECT v.community_place_id,
           COUNT(*)::int AS direct_visits,
           MIN(v.visited_at) AS first_direct,
           MAX(v.visited_at) AS last_direct
      FROM public.community_place_visits v
     WHERE v.profile_id = me
       AND v.verification_status = 'verified'
     GROUP BY v.community_place_id
  ),
  meet AS (
    SELECT m.community_place_id,
           COUNT(*)::int AS meetup_supports,
           MAX((m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))::timestamptz) AS last_meetup
      FROM public.attendance a
      JOIN public.meetups m ON m.id = a.meetup_id
     WHERE a.profile_id = me
       AND a.status::text IN ('checked_in','attended')
       AND m.status <> 'cancelled'::meetup_status
       AND m.community_place_id IS NOT NULL
       AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
     GROUP BY m.community_place_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.last_activity_at DESC, t.name ASC), '[]'::jsonb)
    INTO items
  FROM (
    SELECT p.id AS community_place_id,
           p.name,
           p.category::text AS category,
           p.neighborhood,
           p.address,
           CASE WHEN p.image_rights_status = 'cleared' THEN p.cover_image_url ELSE NULL END AS cover_image_url,
           (p.image_rights_status = 'cleared' AND p.cover_image_url IS NOT NULL) AS has_cover_image,
           p.veggie_classification,
           p.is_active,
           COALESCE(p.maintenance_status, 'operational') AS maintenance_status,
           s.first_supported_at AS first_activity_at,
           s.last_supported_at  AS last_activity_at,
           COALESCE(d.direct_visits, 0) AS direct_visit_count,
           CASE
             WHEN COALESCE(d.direct_visits,0) > 0 AND COALESCE(mt.meetup_supports,0) > 0 THEN 'both'
             WHEN COALESCE(d.direct_visits,0) > 0 THEN 'direct_place_visit'
             ELSE 'meetup_attendance'
           END AS support_source
      FROM supports s
      JOIN public.community_places p ON p.id = s.community_place_id
      LEFT JOIN direct d ON d.community_place_id = s.community_place_id
      LEFT JOIN meet mt ON mt.community_place_id = s.community_place_id
  ) t;

  RETURN jsonb_build_object(
    'places', items,
    'distinct_supported', jsonb_array_length(items),
    'direct_visits_total', (
      SELECT COUNT(*)::int FROM public.community_place_visits v
       WHERE v.profile_id = me AND v.verification_status = 'verified'
    )
  );
END; $function$;