
-- 1. Add 'declined' to invitation_status enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'invitation_status' AND e.enumlabel = 'declined'
  ) THEN
    ALTER TYPE public.invitation_status ADD VALUE 'declined';
  END IF;
END $$;

-- 2. meetup_update_seen table
CREATE TABLE IF NOT EXISTS public.meetup_update_seen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meetup_id UUID NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, meetup_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetup_update_seen TO authenticated;
GRANT ALL ON public.meetup_update_seen TO service_role;
ALTER TABLE public.meetup_update_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_meetup_update_seen" ON public.meetup_update_seen
  FOR ALL TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());
CREATE TRIGGER meetup_update_seen_updated_at BEFORE UPDATE ON public.meetup_update_seen
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Decline invitation RPC
CREATE OR REPLACE FUNCTION public.decline_meetup_invitation(_invitation_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := public.current_profile_id();
  inv RECORD;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO inv FROM public.meetup_invitations WHERE id = _invitation_id;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF inv.recipient_id <> me THEN RAISE EXCEPTION 'Not your invitation'; END IF;
  IF inv.status = 'joined' THEN RAISE EXCEPTION 'Already joined this meetup'; END IF;
  UPDATE public.meetup_invitations
    SET status = 'declined', updated_at = now()
    WHERE id = _invitation_id;
END $$;
GRANT EXECUTE ON FUNCTION public.decline_meetup_invitation(UUID) TO authenticated;

-- 4. Acknowledge meetup update
CREATE OR REPLACE FUNCTION public.acknowledge_meetup_update(_meetup_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := public.current_profile_id();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.meetup_update_seen (profile_id, meetup_id, seen_at)
  VALUES (me, _meetup_id, now())
  ON CONFLICT (profile_id, meetup_id) DO UPDATE SET seen_at = now(), updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION public.acknowledge_meetup_update(UUID) TO authenticated;

-- 5. get_my_plans
CREATE OR REPLACE FUNCTION public.get_my_plans(
  _past_cursor TIMESTAMPTZ DEFAULT NULL,
  _past_limit INT DEFAULT 20
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    RETURN jsonb_build_object('needs_attention','[]'::jsonb,'upcoming','[]'::jsonb,
      'hosting','[]'::jsonb,'past','[]'::jsonb,'past_next_cursor',NULL,
      'generated_at', now_ts);
  END IF;

  -- Build a working set of (meetup, role, states) then classify.
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
  -- Meetups relevant to me: hosted, attending, invited, or has follow-up state
  relevant AS (
    SELECT DISTINCT meetup_id FROM (
      SELECT id AS meetup_id FROM public.meetups WHERE host_id = me
      UNION SELECT meetup_id FROM my_att
      UNION SELECT meetup_id FROM my_inv
      UNION SELECT meetup_id FROM my_follow
    ) x
  ),
  enriched AS (
    SELECT
      b.id AS meetup_id,
      b.title,
      b.cover_image_url,
      b.category::text AS category,
      b.date, b.start_time, b.end_time, b.timezone,
      b.starts_at, b.ends_at, b.status::text AS meetup_status,
      b.host_id, b.host_name, b.host_avatar,
      b.capacity,
      COALESCE(ac.cnt, 0) AS attendee_count,
      b.city_name_snapshot, b.neighborhood, b.location_name, b.address,
      (b.host_id = me) AS is_host,
      ma.att_status,
      ma.checked_in_at IS NOT NULL AS is_checked_in,
      mi.id AS invitation_id,
      mi.personal_message AS invitation_message,
      mi.status::text AS invitation_status,
      mi.sender_id AS invitation_sender_id,
      mf.viewed_at AS follow_up_viewed_at,
      mf.dismissed_at AS follow_up_dismissed_at,
      u.last_change,
      s.seen_at,
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
        WHEN e.is_host AND e.starts_at > now_ts AND e.meetup_status <> 'cancelled'
          THEN 'hosting'
        WHEN e.att_status IS NOT NULL AND e.starts_at > now_ts AND e.meetup_status <> 'cancelled'
          THEN 'upcoming'
        WHEN (e.att_status IS NOT NULL OR e.is_host) AND e.ends_at < now_ts
             AND (e.follow_up_viewed_at IS NULL AND e.follow_up_dismissed_at IS NULL)
             AND e.ends_at > now_ts - INTERVAL '7 days'
             AND e.meetup_status <> 'cancelled'
          THEN 'follow_up'
        WHEN (e.att_status IS NOT NULL OR e.is_host) AND e.ends_at < now_ts
          THEN 'past'
        ELSE NULL
      END AS bucket
    FROM enriched e
  ),
  -- Deduplicate: one row per meetup, using the priority order in classification.
  ranked AS (
    SELECT c.*,
      CASE c.bucket
        WHEN 'active' THEN 1
        WHEN 'update' THEN 2
        WHEN 'cancelled' THEN 3
        WHEN 'invitation' THEN 4
        WHEN 'hosting' THEN 5
        WHEN 'upcoming' THEN 6
        WHEN 'follow_up' THEN 7
        WHEN 'past' THEN 8
        ELSE 99
      END AS prio
    FROM classified c
    WHERE c.bucket IS NOT NULL
  ),
  final AS (
    SELECT DISTINCT ON (meetup_id) *
    FROM ranked
    ORDER BY meetup_id, prio
  )
  SELECT
    COALESCE(jsonb_agg(to_plan(f)) FILTER (WHERE f.bucket IN ('active','update','cancelled','invitation','follow_up')
      AND (f.bucket <> 'follow_up' OR f.ends_at < now_ts)), '[]'::jsonb)
  INTO needs_attention
  FROM (SELECT * FROM final ORDER BY starts_at ASC) f;

  -- shortcut: build lists per bucket via helper subqueries
  SELECT COALESCE(jsonb_agg(to_plan(f) ORDER BY f.starts_at ASC), '[]'::jsonb)
    INTO needs_attention
  FROM final f
  WHERE f.bucket IN ('active','update','cancelled','invitation','follow_up');

  SELECT COALESCE(jsonb_agg(to_plan(f) ORDER BY f.starts_at ASC), '[]'::jsonb)
    INTO upcoming
  FROM final f WHERE f.bucket = 'upcoming';

  SELECT COALESCE(jsonb_agg(to_plan(f) ORDER BY f.starts_at ASC), '[]'::jsonb)
    INTO hosting
  FROM final f WHERE f.bucket = 'hosting';

  -- Past: cursor by starts_at DESC
  SELECT COALESCE(jsonb_agg(to_plan(f) ORDER BY f.starts_at DESC), '[]'::jsonb)
    INTO past
  FROM (
    SELECT * FROM final
    WHERE bucket = 'past'
      AND (_past_cursor IS NULL OR starts_at < _past_cursor)
    ORDER BY starts_at DESC
    LIMIT _past_limit
  ) f;

  SELECT MIN(starts_at) INTO past_next
  FROM (
    SELECT starts_at FROM final
    WHERE bucket = 'past'
      AND (_past_cursor IS NULL OR starts_at < _past_cursor)
    ORDER BY starts_at DESC
    LIMIT _past_limit
  ) x;

  RETURN jsonb_build_object(
    'needs_attention', needs_attention,
    'upcoming', upcoming,
    'hosting', hosting,
    'past', past,
    'past_next_cursor', past_next,
    'generated_at', now_ts
  );
END $$;

-- Helper: convert a row from `final` to a plan JSON object.
CREATE OR REPLACE FUNCTION public.to_plan(r ANYELEMENT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN jsonb_build_object(
    'plan_type', r.bucket,
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
    'host', jsonb_build_object('id', r.host_id, 'name', r.host_name, 'avatar', r.host_avatar),
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
    'primary_action', CASE r.bucket
      WHEN 'active' THEN CASE WHEN r.is_checked_in THEN 'open_chat' ELSE 'check_in' END
      WHEN 'update' THEN 'view_meetup'
      WHEN 'cancelled' THEN 'view_meetup'
      WHEN 'invitation' THEN 'review_invitation'
      WHEN 'hosting' THEN 'manage_meetup'
      WHEN 'upcoming' THEN 'view_meetup'
      WHEN 'follow_up' THEN 'view_summary'
      WHEN 'past' THEN 'view_summary'
      ELSE 'view_meetup' END,
    'reason_code', r.bucket,
    'reason_label', CASE r.bucket
      WHEN 'active' THEN 'Happening now'
      WHEN 'update' THEN 'Meetup updated'
      WHEN 'cancelled' THEN 'Meetup cancelled'
      WHEN 'invitation' THEN 'Invitation received'
      WHEN 'hosting' THEN 'You''re hosting'
      WHEN 'upcoming' THEN 'You''re going'
      WHEN 'follow_up' THEN 'Reflect on this Meetup'
      WHEN 'past' THEN 'Attended'
      ELSE NULL END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.to_plan(ANYELEMENT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_plans(TIMESTAMPTZ, INT) TO authenticated;
