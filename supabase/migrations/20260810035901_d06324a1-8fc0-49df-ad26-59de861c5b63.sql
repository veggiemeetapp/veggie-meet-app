-- WO-087 — /you data access consolidation + index hygiene

CREATE OR REPLACE FUNCTION public.get_my_you_summary(_history_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me UUID := public.current_profile_id();
  now_ts TIMESTAMPTZ := now();
  hist_lim INT := LEAST(GREATEST(COALESCE(_history_limit, 8), 1), 10);
  -- /you renders short previews only; My Plans stays the canonical paginated
  -- history surface. Upcoming sections are hard-capped, not paginated.
  live_cap CONSTANT INT := 10;
  result JSONB;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  WITH blocked AS (
    SELECT b.blocked_profile_id AS pid FROM public.user_blocks b WHERE b.blocker_profile_id = me
    UNION
    SELECT b.blocker_profile_id AS pid FROM public.user_blocks b WHERE b.blocked_profile_id = me
  ),
  my_att AS (
    SELECT a.meetup_id, a.status::text AS att_status
    FROM public.attendance a
    WHERE a.profile_id = me
      AND a.status NOT IN ('cancelled','removed')
  ),
  relevant AS (
    SELECT m.id
    FROM public.meetups m
    WHERE m.host_id = me
    UNION
    SELECT a.meetup_id FROM my_att a
  ),
  base AS (
    SELECT
      m.id AS meetup_id, m.title, m.category::text AS category,
      m.cover_image_url, m.date, m.start_time, m.end_time, m.timezone,
      m.capacity, m.status::text AS meetup_status,
      m.city_name_snapshot, m.neighborhood,
      COALESCE(m.location_name, m.custom_location_name) AS location_name,
      COALESCE(m.address, m.custom_location_address) AS address,
      m.community_place_id,
      (m.host_id = me) AS is_host,
      ma.att_status,
      public.meetup_start_at(m.date, m.start_time, m.timezone) AS starts_at,
      public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) AS ends_at,
      EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = m.id) AS is_completed,
      (SELECT count(*)::int FROM public.attendance a2
        WHERE a2.meetup_id = m.id AND a2.status NOT IN ('cancelled','removed')) AS attendee_count
    FROM public.meetups m
    JOIN relevant r ON r.id = m.id
    LEFT JOIN my_att ma ON ma.meetup_id = m.id
    -- Block suppression: never surface a Meetup hosted by a suppressed member.
    WHERE m.host_id = me OR m.host_id NOT IN (SELECT pid FROM blocked)
  ),
  lifecycled AS (
    SELECT b.*,
      CASE
        WHEN b.meetup_status = 'cancelled' THEN 'cancelled'
        WHEN b.is_completed THEN 'completed'
        WHEN now_ts > b.ends_at THEN 'ended'
        WHEN now_ts >= b.starts_at THEN 'in_progress'
        ELSE 'upcoming'
      END AS lifecycle_state
    FROM base b
  ),
  card AS (
    SELECT l.*,
      jsonb_build_object(
        'meetup_id', l.meetup_id,
        'title', l.title,
        'category', l.category,
        'cover_image_url', l.cover_image_url,
        'date', l.date,
        'start_time', l.start_time,
        'end_time', l.end_time,
        'timezone', l.timezone,
        'capacity', l.capacity,
        'attendee_count', l.attendee_count,
        'city_name', l.city_name_snapshot,
        'neighborhood', l.neighborhood,
        'location_name', l.location_name,
        'address', l.address,
        'community_place_id', l.community_place_id,
        'meetup_status', l.meetup_status,
        'lifecycle_state', l.lifecycle_state,
        'is_host', l.is_host,
        'attendance_status', l.att_status
      ) AS card
    FROM lifecycled l
  )
  SELECT jsonb_build_object(
    'hosting', COALESCE((
      SELECT jsonb_agg(c.card ORDER BY c.starts_at ASC)
      FROM (
        SELECT * FROM card
        WHERE is_host AND lifecycle_state IN ('upcoming','in_progress')
        ORDER BY starts_at ASC LIMIT live_cap
      ) c
    ), '[]'::jsonb),
    'going', COALESCE((
      SELECT jsonb_agg(c.card ORDER BY c.starts_at ASC)
      FROM (
        SELECT * FROM card
        WHERE NOT is_host AND att_status IS NOT NULL
          AND lifecycle_state IN ('upcoming','in_progress')
        ORDER BY starts_at ASC LIMIT live_cap
      ) c
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'meetup_id', c.meetup_id,
          'title', c.title,
          'date', c.date,
          'start_time', c.start_time,
          'cover_image_url', c.cover_image_url,
          'is_host', c.is_host,
          'attendance_status', CASE WHEN c.is_host THEN 'hosted' ELSE c.att_status END,
          'cancelled', (c.lifecycle_state = 'cancelled'),
          'lifecycle_state', c.lifecycle_state
        ) ORDER BY c.starts_at DESC, c.meetup_id DESC
      )
      FROM (
        SELECT * FROM card
        WHERE lifecycle_state IN ('ended','completed','cancelled')
        ORDER BY starts_at DESC, meetup_id DESC LIMIT hist_lim
      ) c
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'hosting_upcoming', (SELECT count(*)::int FROM card WHERE is_host AND lifecycle_state IN ('upcoming','in_progress')),
      'going_upcoming', (SELECT count(*)::int FROM card WHERE NOT is_host AND att_status IS NOT NULL AND lifecycle_state IN ('upcoming','in_progress')),
      'history_total', (SELECT count(*)::int FROM card WHERE lifecycle_state IN ('ended','completed','cancelled'))
    ),
    'history_limit', hist_lim,
    'history_has_more', (SELECT count(*) FROM card WHERE lifecycle_state IN ('ended','completed','cancelled')) > hist_lim,
    'server_time', now_ts
  ) INTO result;

  RETURN result;
END;
$function$;

ALTER FUNCTION public.get_my_you_summary(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_you_summary(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_you_summary(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_you_summary(integer) TO authenticated;

-- Index hygiene: drop the two redundant duplicates confirmed against the
-- production catalog. Survivors keep the <table>_<cols>_idx convention.
DROP INDEX IF EXISTS public.idx_attendance_meetup_status;
DROP INDEX IF EXISTS public.idx_meetups_host_date;