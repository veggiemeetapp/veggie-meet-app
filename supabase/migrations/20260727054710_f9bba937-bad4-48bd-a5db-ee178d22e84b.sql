CREATE OR REPLACE FUNCTION public.get_my_plans(_past_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, _past_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me UUID := public.current_profile_id();
  now_ts TIMESTAMPTZ := now();
  needs_attention JSONB := '[]'::jsonb;
  upcoming JSONB := '[]'::jsonb;
  hosting JSONB := '[]'::jsonb;
  past JSONB := '[]'::jsonb;
  past_next TIMESTAMPTZ;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  WITH
  base AS (
    SELECT m.*,
      ((m.date::timestamp + m.start_time) AT TIME ZONE COALESCE(m.timezone,'UTC')) AS starts_at,
      ((m.date::timestamp + m.end_time)   AT TIME ZONE COALESCE(m.timezone,'UTC')) AS ends_at,
      p.display_name AS host_name,
      p.avatar_url  AS host_avatar
    FROM public.meetups m
    JOIN public.profiles p ON p.id = m.host_id
  ),
  my_att AS (
    SELECT a.meetup_id, a.status::text AS att_status, a.joined_at, a.checked_in_at
    FROM public.attendance a
    WHERE a.profile_id = me AND a.status NOT IN ('cancelled','removed')
  ),
  my_inv AS (
    SELECT DISTINCT ON (i.meetup_id) i.*
    FROM public.meetup_invitations i
    WHERE i.recipient_id = me AND i.status IN ('invited','viewed')
    ORDER BY i.meetup_id, i.created_at DESC
  ),
  my_follow AS (
    SELECT f.meetup_id, f.viewed_at, f.dismissed_at
    FROM public.meetup_follow_up_state f
    WHERE f.profile_id = me
  ),
  updates AS (
    SELECT lc.meetup_id, MAX(lc.changed_at) AS last_change
    FROM public.meetup_location_changes lc
    WHERE lc.meaningful_change = true
    GROUP BY lc.meetup_id
  ),
  seen AS (
    SELECT s.meetup_id, s.seen_at FROM public.meetup_update_seen s WHERE s.profile_id = me
  ),
  att_counts AS (
    SELECT meetup_id, count(*)::int AS cnt
    FROM public.attendance
    WHERE status NOT IN ('cancelled','removed')
    GROUP BY meetup_id
  ),
  relevant AS (
    SELECT DISTINCT meetup_id FROM (
      SELECT meetup_id FROM my_att
      UNION ALL SELECT meetup_id FROM my_inv
      UNION ALL SELECT meetup_id FROM my_follow
      UNION ALL SELECT b.id AS meetup_id FROM base b WHERE b.host_id = me
    ) u
  ),
  enriched AS (
    SELECT
      b.id AS meetup_id, b.title, b.cover_image_url, b.category::text AS category,
      b.date, b.start_time, b.end_time, b.timezone,
      b.starts_at, b.ends_at, b.status::text AS meetup_status,
      b.host_id, b.host_name, b.host_avatar,
      b.capacity, COALESCE(ac.cnt, 0) AS attendee_count,
      b.city_name_snapshot, b.neighborhood, b.location_name, b.address,
      (b.host_id = me) AS is_host,
      ma.att_status,
      ma.checked_in_at IS NOT NULL AS is_checked_in,
      mi.id AS invitation_id, mi.personal_message AS invitation_message,
      mi.status::text AS invitation_status, mi.sender_id AS invitation_sender_id,
      mf.viewed_at AS follow_up_viewed_at, mf.dismissed_at AS follow_up_dismissed_at,
      u.last_change, s.seen_at,
      (u.last_change IS NOT NULL AND (s.seen_at IS NULL OR u.last_change > s.seen_at)
        AND b.status <> 'cancelled') AS has_unseen_update
    FROM base b
    JOIN relevant r ON r.meetup_id = b.id
    LEFT JOIN my_att ma ON ma.meetup_id = b.id
    LEFT JOIN my_inv mi ON mi.meetup_id = b.id
    LEFT JOIN my_follow mf ON mf.meetup_id = b.id
    LEFT JOIN updates u ON u.meetup_id = b.id
    LEFT JOIN seen s ON s.meetup_id = b.id
    LEFT JOIN att_counts ac ON ac.meetup_id = b.id
  ),
  classified AS (
    SELECT e.*,
      CASE
        WHEN e.meetup_status = 'cancelled' AND e.starts_at >= now_ts - INTERVAL '7 days'
          THEN 'cancelled'
        WHEN (e.att_status IS NOT NULL OR e.is_host)
             AND now_ts BETWEEN (e.starts_at - INTERVAL '30 minutes') AND e.ends_at
             AND e.meetup_status <> 'cancelled'
          THEN 'active'
        WHEN e.has_unseen_update AND e.ends_at > now_ts
          THEN 'update'
        WHEN e.invitation_id IS NOT NULL AND e.starts_at > now_ts AND e.meetup_status <> 'cancelled'
          THEN 'invitation'
        WHEN e.is_host AND e.ends_at > now_ts AND e.meetup_status <> 'cancelled'
          THEN 'hosting'
        WHEN e.att_status IS NOT NULL AND e.starts_at > now_ts AND e.meetup_status <> 'cancelled'
          THEN 'upcoming'
        WHEN e.follow_up_viewed_at IS NULL AND e.follow_up_dismissed_at IS NULL
             AND e.ends_at < now_ts AND e.ends_at > now_ts - INTERVAL '7 days'
             AND (e.att_status IS NOT NULL OR e.is_host)
          THEN 'follow_up'
        WHEN (e.att_status IS NOT NULL OR e.is_host) AND e.ends_at <= now_ts
          THEN 'past'
        ELSE NULL
      END AS plan_type
    FROM enriched e
  ),
  final AS (
    SELECT c.* FROM classified c WHERE c.plan_type IS NOT NULL
  ),
  pastq AS (
    SELECT f.* FROM final f
    WHERE f.plan_type = 'past'
      AND (_past_cursor IS NULL OR f.starts_at < _past_cursor)
    ORDER BY f.starts_at DESC
    LIMIT _past_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(public.to_plan(f.*) ORDER BY f.starts_at)
              FROM final f WHERE f.plan_type IN ('active','update','invitation','cancelled','follow_up')), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(public.to_plan(f.*) ORDER BY f.starts_at)
              FROM final f WHERE f.plan_type = 'upcoming'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(public.to_plan(f.*) ORDER BY f.starts_at)
              FROM final f WHERE f.plan_type = 'hosting'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(public.to_plan(p.*) ORDER BY p.starts_at DESC) FROM pastq p), '[]'::jsonb),
    (SELECT MIN(p.starts_at) FROM pastq p)
  INTO needs_attention, upcoming, hosting, past, past_next;

  RETURN jsonb_build_object(
    'needs_attention', needs_attention,
    'upcoming', upcoming,
    'hosting', hosting,
    'past', past,
    'past_next_cursor', past_next,
    'generated_at', now_ts
  );
END;
$function$;