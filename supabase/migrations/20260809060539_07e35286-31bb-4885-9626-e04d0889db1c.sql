-- WO-079: My Plans lifecycle integrity

DROP FUNCTION IF EXISTS public.get_my_plans(timestamptz, integer);

CREATE OR REPLACE FUNCTION public.to_plan(r anyelement)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'plan_type', r.plan_type,
    'meetup_id', r.meetup_id,
    'title', r.title,
    'image', r.cover_image_url,
    'category', r.category,
    'role', CASE WHEN r.is_host THEN 'host'
                 WHEN r.is_checked_in THEN 'checked_in'
                 WHEN r.att_status IS NOT NULL THEN 'attendee'
                 WHEN r.invitation_id IS NOT NULL THEN 'invitee'
                 ELSE 'viewer' END,
    'date', r.date,
    'start_time', r.start_time,
    'end_time', r.end_time,
    'timezone', r.timezone,
    'starts_at', r.starts_at,
    'ends_at', r.ends_at,
    'meetup_status', r.meetup_status,
    'lifecycle_state', r.lifecycle_state,
    'is_completed', r.is_completed,
    'can_check_in', r.can_check_in,
    'can_leave', r.can_leave,
    'can_complete', r.can_complete,
    'host', jsonb_build_object(
      'id', CASE WHEN r.host_deleted THEN NULL ELSE r.host_id END,
      'name', r.host_name,
      'avatar', CASE WHEN r.host_deleted THEN NULL ELSE r.host_avatar END
    ),
    'location', jsonb_build_object(
      'city', r.city_name_snapshot,
      'neighborhood', r.neighborhood,
      'name', r.location_name,
      'address', r.address
    ),
    'capacity', r.capacity,
    'attendee_count', r.attendee_count,
    'attendance_state', r.att_status,
    'invitation', CASE WHEN r.invitation_id IS NULL THEN NULL ELSE
      jsonb_build_object('id', r.invitation_id, 'message', r.invitation_message,
        'status', r.invitation_status, 'sender_id', r.invitation_sender_id)
      END,
    'has_unseen_update', r.has_unseen_update,
    'primary_action', CASE r.plan_type
      WHEN 'active' THEN CASE WHEN r.can_check_in THEN 'check_in' ELSE 'open_chat' END
      WHEN 'update' THEN 'view_meetup'
      WHEN 'cancelled' THEN 'view_meetup'
      WHEN 'invitation' THEN 'review_invitation'
      WHEN 'hosting' THEN 'manage_meetup'
      WHEN 'upcoming' THEN 'view_meetup'
      WHEN 'follow_up' THEN 'view_summary'
      WHEN 'past' THEN 'view_summary'
      ELSE 'view_meetup' END,
    'reason_code', r.plan_type,
    'reason_label', CASE
      WHEN r.plan_type = 'active' THEN 'Happening now'
      WHEN r.plan_type = 'update' THEN 'Meetup updated'
      WHEN r.plan_type = 'cancelled' THEN 'Meetup cancelled'
      WHEN r.plan_type = 'invitation' THEN 'Invitation received'
      WHEN r.plan_type = 'hosting' THEN 'You''re hosting'
      WHEN r.plan_type = 'upcoming' THEN 'You''re going'
      WHEN r.plan_type = 'follow_up' THEN 'Reflect on this Meetup'
      WHEN r.plan_type = 'past' AND r.lifecycle_state = 'cancelled' THEN 'Meetup cancelled'
      WHEN r.plan_type = 'past' AND r.is_completed THEN 'Completed'
      WHEN r.plan_type = 'past' THEN 'Ended'
      ELSE NULL END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_plans(
  _past_cursor text DEFAULT NULL,
  _past_limit integer DEFAULT 20
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me UUID := public.current_profile_id();
  now_ts TIMESTAMPTZ := now();
  lim INT := LEAST(GREATEST(COALESCE(_past_limit, 20), 1), 50);
  cur_ts TIMESTAMPTZ;
  cur_id UUID;
  needs_attention JSONB := '[]'::jsonb;
  upcoming JSONB := '[]'::jsonb;
  hosting JSONB := '[]'::jsonb;
  past JSONB := '[]'::jsonb;
  past_next TEXT;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _past_cursor IS NOT NULL AND btrim(_past_cursor) <> '' THEN
    cur_ts := split_part(_past_cursor, '|', 1)::timestamptz;
    cur_id := NULLIF(split_part(_past_cursor, '|', 2), '')::uuid;
  END IF;

  WITH
  blocked AS (
    SELECT b.blocked_profile_id AS pid FROM public.user_blocks b WHERE b.blocker_profile_id = me
    UNION
    SELECT b.blocker_profile_id AS pid FROM public.user_blocks b WHERE b.blocked_profile_id = me
  ),
  base AS (
    SELECT m.*,
      public.meetup_start_at(m.date, m.start_time, m.timezone) AS starts_at,
      public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) AS ends_at,
      CASE WHEN p.deleted_at IS NOT NULL THEN 'Former member' ELSE p.display_name END AS host_name,
      p.avatar_url AS host_avatar,
      (p.deleted_at IS NOT NULL) AS host_deleted
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
    WHERE i.recipient_id = me
      AND i.status IN ('invited','viewed')
      AND i.sender_id NOT IN (SELECT pid FROM blocked)
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
    SELECT meetup_id,
           count(*)::int AS cnt,
           count(*) FILTER (WHERE status IN ('checked_in','attended'))::int AS checked_in_cnt
    FROM public.attendance
    WHERE status NOT IN ('cancelled','removed')
    GROUP BY meetup_id
  ),
  other_checked_in AS (
    SELECT a.meetup_id, count(*)::int AS cnt
    FROM public.attendance a
    JOIN public.meetups m2 ON m2.id = a.meetup_id
    WHERE a.status IN ('checked_in','attended') AND a.profile_id <> m2.host_id
    GROUP BY a.meetup_id
  ),
  completions AS (
    SELECT c.meetup_id, MIN(c.completed_at) AS completed_at
    FROM public.meetup_completions c GROUP BY c.meetup_id
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
      b.host_id, b.host_name, b.host_avatar, b.host_deleted,
      b.capacity, COALESCE(ac.cnt, 0) AS attendee_count,
      b.city_name_snapshot, b.neighborhood, b.location_name, b.address,
      (b.host_id = me) AS is_host,
      ma.att_status,
      ma.checked_in_at IS NOT NULL AS is_checked_in,
      mi.id AS invitation_id, mi.personal_message AS invitation_message,
      mi.status::text AS invitation_status, mi.sender_id AS invitation_sender_id,
      mf.viewed_at AS follow_up_viewed_at, mf.dismissed_at AS follow_up_dismissed_at,
      u.last_change, s.seen_at,
      (cp.completed_at IS NOT NULL) AS is_completed,
      COALESCE(oc.cnt, 0) AS other_checked_in_count,
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
    LEFT JOIN other_checked_in oc ON oc.meetup_id = b.id
    LEFT JOIN completions cp ON cp.meetup_id = b.id
  ),
  lifecycled AS (
    SELECT e.*,
      CASE
        WHEN e.meetup_status = 'cancelled' THEN 'cancelled'
        WHEN e.is_completed THEN 'completed'
        WHEN now_ts > e.ends_at THEN 'ended'
        WHEN now_ts >= e.starts_at THEN 'in_progress'
        ELSE 'upcoming'
      END AS lifecycle_state
    FROM enriched e
  ),
  actioned AS (
    SELECT l.*,
      (l.lifecycle_state IN ('in_progress','ended')
        AND l.meetup_status <> 'cancelled'
        AND NOT l.is_completed
        AND l.att_status = 'joined'
        AND public.meetup_in_check_in_window(l.meetup_id) = 'open'
      ) AS can_check_in,
      (NOT l.is_host
        AND l.att_status = 'joined'
        AND NOT l.is_checked_in
        AND l.lifecycle_state = 'upcoming'
      ) AS can_leave,
      (l.is_host
        AND l.lifecycle_state = 'ended'
        AND l.other_checked_in_count > 0
      ) AS can_complete
    FROM lifecycled l
  ),
  classified AS (
    SELECT a.*,
      CASE
        WHEN a.lifecycle_state = 'cancelled' AND a.starts_at >= now_ts - INTERVAL '7 days'
          THEN 'cancelled'
        WHEN (a.att_status IS NOT NULL OR a.is_host)
             AND a.lifecycle_state = 'in_progress'
          THEN 'active'
        WHEN a.has_unseen_update AND a.lifecycle_state IN ('upcoming','in_progress')
          THEN 'update'
        WHEN a.invitation_id IS NOT NULL AND a.lifecycle_state = 'upcoming'
          THEN 'invitation'
        WHEN a.is_host AND a.lifecycle_state = 'upcoming'
          THEN 'hosting'
        WHEN a.att_status IS NOT NULL AND a.lifecycle_state = 'upcoming'
          THEN 'upcoming'
        WHEN a.follow_up_viewed_at IS NULL AND a.follow_up_dismissed_at IS NULL
             AND a.lifecycle_state IN ('ended','completed')
             AND a.ends_at > now_ts - INTERVAL '7 days'
             AND (a.att_status IS NOT NULL OR a.is_host)
          THEN 'follow_up'
        WHEN (a.att_status IS NOT NULL OR a.is_host)
             AND a.lifecycle_state IN ('ended','completed','cancelled')
          THEN 'past'
        ELSE NULL
      END AS plan_type
    FROM actioned a
  ),
  final AS (
    SELECT c.* FROM classified c WHERE c.plan_type IS NOT NULL
  ),
  pastq_raw AS (
    SELECT f.*, row_number() OVER (ORDER BY f.starts_at DESC, f.meetup_id DESC) AS rn
    FROM final f
    WHERE f.plan_type = 'past'
      AND (cur_ts IS NULL
           OR f.starts_at < cur_ts
           OR (f.starts_at = cur_ts AND (cur_id IS NULL OR f.meetup_id < cur_id)))
    ORDER BY f.starts_at DESC, f.meetup_id DESC
    LIMIT lim + 1
  ),
  pastq AS (
    SELECT * FROM pastq_raw WHERE rn <= lim
  )
  SELECT
    COALESCE((SELECT jsonb_agg(public.to_plan(f.*) ORDER BY f.starts_at, f.meetup_id)
              FROM final f WHERE f.plan_type IN ('active','update','invitation','cancelled','follow_up')), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(public.to_plan(f.*) ORDER BY f.starts_at, f.meetup_id)
              FROM final f WHERE f.plan_type = 'upcoming'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(public.to_plan(f.*) ORDER BY f.starts_at, f.meetup_id)
              FROM final f WHERE f.plan_type = 'hosting'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(public.to_plan(p.*) ORDER BY p.starts_at DESC, p.meetup_id DESC) FROM pastq p), '[]'::jsonb),
    CASE
      WHEN (SELECT count(*) FROM pastq_raw) > lim
        THEN (SELECT p.starts_at::text || '|' || p.meetup_id::text
              FROM pastq p ORDER BY p.starts_at ASC, p.meetup_id ASC LIMIT 1)
      ELSE NULL
    END
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

REVOKE ALL ON FUNCTION public.get_my_plans(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.to_plan(anyelement) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_plans(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.to_plan(anyelement) TO authenticated;