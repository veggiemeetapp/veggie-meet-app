-- 2026-11-22 (c) — Community Places are no longer vegan-only.
--
-- The owner workspace has published vegetarian / vegan-options places for a
-- while (classification vocabulary from WO-108), and the map, search and
-- check-in RPCs already serve them. Two leftovers from the vegan-only era
-- made those places half-visible and permanently flagged:
--
--  1. get_community_place_detail returned {found:false} for any
--     classification other than 'fully_vegan', so a place listed on Explore
--     opened as "This place isn't available". Visibility is now governed by
--     is_active / verification_status / maintenance_status only; the
--     classification is returned as data and labelled on the page.
--  2. get_community_place_operations_dashboard flagged every non-vegan
--     classification as the "vegan_unconfirmed" blocker. It now flags only a
--     genuine downgrade ('not_confirmed_fully_vegan', set by a vegan review).
--
-- Both functions are otherwise identical to their previous definitions
-- (20260807103054 and 20260804151648).

CREATE OR REPLACE FUNCTION public.get_community_place_detail(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  p record;
  my_visits int := 0;
  my_last timestamptz;
  supporters int := 0;
  supported_total int := 0;
  counts_toward boolean := false;
  upcoming_count int := 0;
  hosted_count int := 0;
  meetups_json jsonb := '[]'::jsonb;
  freshness text;
  today_local date;
  can_check_in boolean := false;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, category::text AS category, address, neighborhood, timezone,
         cover_image_url, image_rights_status, description, veggie_reason,
         website_url, google_maps_url, veggie_classification,
         COALESCE(maintenance_status, 'operational') AS maintenance_status,
         is_active, verification_status, business_status,
         last_reverified_at, verified_at
    INTO p
    FROM public.community_places
   WHERE id = _place_id;

  IF NOT FOUND
     OR p.is_active IS NOT TRUE
     OR p.verification_status <> 'verified'
     OR p.maintenance_status = 'permanently_closed' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  today_local := (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date;

  SELECT count(*)::int, max(visited_at)
    INTO my_visits, my_last
    FROM public.community_place_visits v
   WHERE v.profile_id = me
     AND v.community_place_id = _place_id
     AND v.verification_status = 'verified';

  SELECT count(DISTINCT v.profile_id)::int
    INTO supporters
    FROM public.community_place_visits v
   WHERE v.community_place_id = _place_id
     AND v.verification_status = 'verified';

  SELECT count(*)::int INTO supported_total FROM public._legit_place_supports(me);
  counts_toward := EXISTS (
    SELECT 1 FROM public._legit_place_supports(me) s
     WHERE s.community_place_id = _place_id
  );

  SELECT count(*)::int INTO upcoming_count
    FROM public.meetups m
   WHERE m.community_place_id = _place_id
     AND m.status <> 'cancelled'::meetup_status
     AND m.date >= today_local;

  SELECT count(*)::int INTO hosted_count
    FROM public.meetups m
   WHERE m.community_place_id = _place_id
     AND m.status = 'past'::meetup_status;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
    INTO meetups_json
    FROM (
      SELECT jsonb_build_object(
               'id', m.id,
               'title', m.title,
               'category', m.category::text,
               'date', m.date,
               'start_time', m.start_time,
               'end_time', m.end_time,
               'status', m.status::text,
               'capacity', m.capacity,
               'attendee_count', (
                 SELECT count(*)::int FROM public.attendance a
                  WHERE a.meetup_id = m.id
                    AND a.status::text IN ('joined','checked_in','attended')
               ),
               'host_display_name', h.display_name,
               'host_avatar_url', h.avatar_url
             ) AS x
        FROM public.meetups m
        LEFT JOIN public.profiles h ON h.id = m.host_id
       WHERE m.community_place_id = _place_id
         AND m.status <> 'cancelled'::meetup_status
         AND m.date >= today_local
       ORDER BY m.date, m.start_time, m.id
       LIMIT 4
    ) q;

  freshness := CASE
    WHEN p.maintenance_status = 'needs_reverification' THEN 'refresh_pending'
    WHEN COALESCE(p.last_reverified_at, p.verified_at) IS NULL THEN 'due_soon'
    WHEN COALESCE(p.last_reverified_at, p.verified_at) > now() - INTERVAL '180 days' THEN 'recent'
    WHEN COALESCE(p.last_reverified_at, p.verified_at) > now() - INTERVAL '365 days' THEN 'due_soon'
    ELSE 'refresh_pending'
  END;

  can_check_in := p.maintenance_status = 'operational'
                  AND (p.business_status IS NULL OR p.business_status = 'OPERATIONAL');

  RETURN jsonb_build_object(
    'found', true,
    'place', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'category', p.category,
      'neighborhood', p.neighborhood,
      'address', p.address,
      'cover_image_url', CASE WHEN p.image_rights_status = 'cleared' THEN p.cover_image_url ELSE NULL END,
      'has_cover_image', p.image_rights_status = 'cleared' AND p.cover_image_url IS NOT NULL,
      'description', p.description,
      'veggie_reason', p.veggie_reason,
      'website_url', p.website_url,
      'google_maps_url', p.google_maps_url,
      'veggie_classification', p.veggie_classification,
      'maintenance_status', p.maintenance_status,
      'verification_freshness', freshness,
      'last_verified_at', COALESCE(p.last_reverified_at, p.verified_at)
    ),
    'my_support', jsonb_build_object(
      'verified_visit_count', my_visits,
      'last_verified_visit_at', my_last,
      'counts_toward_supported_places', counts_toward,
      'total_distinct_places_supported', supported_total,
      'check_in_available', can_check_in,
      'in_cooldown', my_last IS NOT NULL AND my_last > now() - INTERVAL '12 hours'
    ),
    'impact', jsonb_build_object(
      'supporter_count', CASE WHEN supporters >= 3 THEN supporters ELSE NULL END,
      'supporter_threshold_met', supporters >= 3,
      'upcoming_meetups', upcoming_count,
      'meetups_hosted', hosted_count
    ),
    'upcoming_meetups', meetups_json,
    'upcoming_meetups_total', upcoming_count,
    'can_host_here', can_check_in
  );
END; $function$;

REVOKE ALL ON FUNCTION public.get_community_place_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_place_detail(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_community_place_operations_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  places_out jsonb;
  attention_out jsonb;
  summary_out jsonb;
  queues_out jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _wo060 (x int) ON COMMIT DROP;

  WITH base AS (
    SELECT p.id,
           p.name,
           p.neighborhood,
           p.category::text AS category,
           p.is_active,
           COALESCE(p.maintenance_status, 'operational') AS maintenance_status,
           p.veggie_classification,
           p.verification_status,
           p.verified_at,
           p.last_reverified_at,
           (p.google_place_id IS NOT NULL) AS has_google_place_id,
           p.veggies_visited_count,
           public.place_freshness_label(p.verified_at, p.last_reverified_at) AS freshness,
           (SELECT count(*)::int FROM public.community_place_reports rp
             WHERE rp.community_place_id = p.id
               AND rp.status IN ('pending','under_review')) AS open_reports_count,
           (SELECT r.id FROM public.community_place_reverifications r
             WHERE r.community_place_id = p.id AND r.status = 'in_progress' LIMIT 1) AS open_reverification_id,
           (SELECT r.id FROM public.community_place_vegan_reviews r
             WHERE r.community_place_id = p.id AND r.status = 'in_progress' LIMIT 1) AS open_vegan_review_id,
           (SELECT r.id FROM public.community_place_identity_reviews r
             WHERE r.community_place_id = p.id AND r.status = 'in_progress' LIMIT 1) AS open_identity_review_id,
           (SELECT r.result FROM public.community_place_reverifications r
             WHERE r.community_place_id = p.id AND r.status = 'completed'
             ORDER BY r.completed_at DESC LIMIT 1) AS last_reverification_result,
           (SELECT r.completed_at FROM public.community_place_reverifications r
             WHERE r.community_place_id = p.id AND r.status = 'completed'
             ORDER BY r.completed_at DESC LIMIT 1) AS last_reverification_at,
           (SELECT count(*)::int FROM public.meetups m
             WHERE m.community_place_id = p.id
               AND m.status <> 'cancelled'::meetup_status
               AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) > now()
           ) AS upcoming_meetups_here
      FROM public.community_places p
  ), enriched AS (
    SELECT b.*,
           (b.last_reverification_result IS NOT NULL
             AND b.last_reverification_result <> 'confirmed_current') AS reverification_needs_action,
           (b.veggie_classification = 'not_confirmed_fully_vegan') AS vegan_unconfirmed,
           (b.maintenance_status = 'permanently_closed' AND b.is_active) AS invalid_state,
           (b.is_active AND b.maintenance_status = 'operational') AS eligible
      FROM base b
  ), healthed AS (
    SELECT e.*,
           CASE
             WHEN e.invalid_state THEN 'data_integrity'
             WHEN e.vegan_unconfirmed THEN 'vegan_unconfirmed'
             WHEN e.maintenance_status = 'permanently_closed' THEN 'permanently_closed'
             WHEN e.maintenance_status = 'temporarily_closed' THEN 'temporarily_closed'
             WHEN NOT e.is_active THEN 'hidden'
             WHEN e.open_identity_review_id IS NOT NULL THEN 'identity_review_in_progress'
             WHEN e.open_vegan_review_id IS NOT NULL THEN 'vegan_review_in_progress'
             WHEN e.reverification_needs_action THEN 'reverification_needs_action'
             WHEN e.open_reports_count > 0 THEN 'open_reports'
             WHEN e.open_reverification_id IS NOT NULL THEN 'reverification_in_progress'
             WHEN e.freshness IN ('due','never_reverified') THEN 'reverification_due'
             WHEN e.freshness = 'due_soon' THEN 'reverification_due_soon'
             ELSE 'healthy'
           END AS health
      FROM enriched e
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', h.id,
      'name', h.name,
      'neighborhood', h.neighborhood,
      'category', h.category,
      'is_active', h.is_active,
      'maintenance_status', h.maintenance_status,
      'veggie_classification', h.veggie_classification,
      'verification_status', h.verification_status,
      'freshness', h.freshness,
      'verified_at', h.verified_at,
      'last_reverified_at', h.last_reverified_at,
      'has_google_place_id', h.has_google_place_id,
      'open_reports_count', h.open_reports_count,
      'open_reviews_count',
        (CASE WHEN h.open_reverification_id IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN h.open_vegan_review_id IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN h.open_identity_review_id IS NOT NULL THEN 1 ELSE 0 END),
      'open_reverification', h.open_reverification_id IS NOT NULL,
      'open_vegan_review', h.open_vegan_review_id IS NOT NULL,
      'open_identity_review', h.open_identity_review_id IS NOT NULL,
      'reverification_needs_action', h.reverification_needs_action,
      'last_reverification_result', h.last_reverification_result,
      'supported_count', h.veggies_visited_count,
      'upcoming_meetups_here', h.upcoming_meetups_here,
      'hosting_eligible', h.eligible,
      'check_in_eligible', h.eligible,
      'health', h.health
    ) ORDER BY h.name ASC), '[]'::jsonb)
  INTO places_out
  FROM healthed h;

  -- Prioritised attention list: at most one primary card per place, with
  -- secondary issue chips, plus separate non-place items (suggestions).
  WITH p AS (
    SELECT * FROM jsonb_to_recordset(places_out) AS x(
      id uuid, name text, neighborhood text, health text,
      open_reports_count int, open_identity_review boolean, open_vegan_review boolean,
      open_reverification boolean, reverification_needs_action boolean,
      is_active boolean, maintenance_status text, freshness text,
      veggie_classification text, last_reverified_at timestamptz, verified_at timestamptz
    )
  ), primary_items AS (
    SELECT
      p.id AS entity_id,
      'place'::text AS entity_kind,
      p.name AS title,
      p.neighborhood AS subtitle,
      CASE
        WHEN p.maintenance_status = 'permanently_closed' AND p.is_active THEN 'data_integrity'
        WHEN p.veggie_classification = 'not_confirmed_fully_vegan' THEN 'vegan_unconfirmed'
        WHEN p.open_identity_review THEN 'identity_review_open'
        WHEN p.open_vegan_review THEN 'vegan_review_open'
        WHEN p.open_reports_count > 0 THEN 'open_report'
        WHEN p.reverification_needs_action THEN 'reverification_needs_action'
        WHEN p.open_reverification THEN 'reverification_in_progress'
        WHEN p.freshness IN ('due','never_reverified') THEN 'reverification_due'
        WHEN NOT p.is_active AND p.maintenance_status = 'operational' THEN 'hidden_operational'
        WHEN p.maintenance_status = 'temporarily_closed' THEN 'temporarily_closed'
        WHEN p.freshness = 'due_soon' THEN 'reverification_due_soon'
        ELSE NULL
      END AS item_type,
      COALESCE(p.last_reverified_at, p.verified_at) AS occurred_at,
      p.open_reports_count,
      p.open_identity_review, p.open_vegan_review, p.open_reverification,
      p.reverification_needs_action, p.is_active, p.maintenance_status, p.freshness
    FROM p
  ), suggestion_items AS (
    SELECT s.id AS entity_id,
           'suggestion'::text AS entity_kind,
           s.place_name AS title,
           NULL::text AS subtitle,
           CASE WHEN s.moderation_status = 'pending' THEN 'suggestion_pending'
                ELSE 'suggestion_under_review' END AS item_type,
           s.submitted_at AS occurred_at
      FROM public.community_place_suggestions s
     WHERE s.moderation_status IN ('pending','under_review')
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.rank ASC, t.occurred_at ASC NULLS FIRST, t.title ASC), '[]'::jsonb)
    INTO attention_out
  FROM (
    SELECT i.entity_id, i.entity_kind, i.title, i.subtitle, i.item_type, i.occurred_at,
           CASE i.item_type
             WHEN 'data_integrity' THEN 1
             WHEN 'vegan_unconfirmed' THEN 2
             WHEN 'identity_review_open' THEN 3
             WHEN 'vegan_review_open' THEN 4
             WHEN 'open_report' THEN 5
             WHEN 'reverification_needs_action' THEN 6
             WHEN 'reverification_in_progress' THEN 7
             WHEN 'reverification_due' THEN 8
             WHEN 'hidden_operational' THEN 10
             WHEN 'temporarily_closed' THEN 11
             WHEN 'reverification_due_soon' THEN 12
             ELSE 99
           END AS rank,
           (
             SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) FROM (
               SELECT 'identity_review_open'::text AS type WHERE i.open_identity_review AND i.item_type <> 'identity_review_open'
               UNION ALL SELECT 'vegan_review_open' WHERE i.open_vegan_review AND i.item_type <> 'vegan_review_open'
               UNION ALL SELECT 'reverification_in_progress' WHERE i.open_reverification AND i.item_type NOT IN ('reverification_in_progress')
               UNION ALL SELECT 'reverification_needs_action' WHERE i.reverification_needs_action AND i.item_type <> 'reverification_needs_action'
               UNION ALL SELECT 'open_report' WHERE i.open_reports_count > 0 AND i.item_type <> 'open_report'
               UNION ALL SELECT 'reverification_due' WHERE i.freshness IN ('due','never_reverified') AND i.item_type <> 'reverification_due'
               UNION ALL SELECT 'hidden' WHERE NOT i.is_active AND i.item_type NOT IN ('hidden_operational','data_integrity','permanently_closed')
               UNION ALL SELECT 'temporarily_closed' WHERE i.maintenance_status = 'temporarily_closed' AND i.item_type <> 'temporarily_closed'
             ) s
           ) AS secondary_types,
           i.open_reports_count
      FROM primary_items i
     WHERE i.item_type IS NOT NULL
    UNION ALL
    SELECT s.entity_id, s.entity_kind, s.title, s.subtitle, s.item_type, s.occurred_at,
           CASE s.item_type WHEN 'suggestion_pending' THEN 9 ELSE 9 END AS rank,
           '[]'::jsonb AS secondary_types,
           0 AS open_reports_count
      FROM suggestion_items s
  ) t;

  SELECT jsonb_build_object(
    'published_places', (SELECT count(*)::int FROM public.community_places),
    'active_places', (SELECT count(*)::int FROM public.community_places WHERE is_active),
    'hidden_places', (SELECT count(*)::int FROM public.community_places WHERE NOT is_active),
    'places_needing_attention', (
      SELECT count(DISTINCT (a->>'entity_id'))::int
        FROM jsonb_array_elements(attention_out) a
       WHERE a->>'entity_kind' = 'place'),
    'open_suggestions', (SELECT count(*)::int FROM public.community_place_suggestions
                          WHERE moderation_status IN ('pending','under_review')),
    'open_reports', (SELECT count(*)::int FROM public.community_place_reports
                      WHERE status IN ('pending','under_review')),
    'reverification_due', (
      SELECT count(*)::int FROM public.community_places p
       WHERE public.place_freshness_label(p.verified_at, p.last_reverified_at) IN ('due','never_reverified')),
    'reverification_due_soon', (
      SELECT count(*)::int FROM public.community_places p
       WHERE public.place_freshness_label(p.verified_at, p.last_reverified_at) = 'due_soon'),
    'reviews_in_progress',
      (SELECT count(*)::int FROM public.community_place_reverifications WHERE status = 'in_progress')
      + (SELECT count(*)::int FROM public.community_place_vegan_reviews WHERE status = 'in_progress')
      + (SELECT count(*)::int FROM public.community_place_identity_reviews WHERE status = 'in_progress'),
    'candidates_total', (SELECT count(*)::int FROM public.place_candidates),
    'attention_items', jsonb_array_length(attention_out)
  ) INTO summary_out;

  SELECT jsonb_build_object(
    'suggestions', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT moderation_status AS k, count(*)::int AS c
          FROM public.community_place_suggestions GROUP BY 1) x),
    'reports', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT status AS k, count(*)::int AS c
          FROM public.community_place_reports GROUP BY 1) x),
    'reverifications', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT status AS k, count(*)::int AS c
          FROM public.community_place_reverifications GROUP BY 1) x),
    'vegan_reviews', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT status AS k, count(*)::int AS c
          FROM public.community_place_vegan_reviews GROUP BY 1) x),
    'identity_reviews', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT status AS k, count(*)::int AS c
          FROM public.community_place_identity_reviews GROUP BY 1) x),
    'candidates', (
      SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
        SELECT verification_status AS k, count(*)::int AS c
          FROM public.place_candidates GROUP BY 1) x)
  ) INTO queues_out;

  RETURN jsonb_build_object(
    'summary', summary_out,
    'places', places_out,
    'attention', attention_out,
    'queues', queues_out,
    'generated_at', now()
  );
END; $function$;

REVOKE ALL ON FUNCTION public.get_community_place_operations_dashboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_community_place_operations_dashboard() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_community_place_operations_dashboard() TO authenticated;
