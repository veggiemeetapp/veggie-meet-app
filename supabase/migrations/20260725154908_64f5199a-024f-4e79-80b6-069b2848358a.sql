CREATE OR REPLACE FUNCTION public.get_my_today_experience()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  my_city text;
  my_interests text[];
  now_ts timestamptz := now();
  today_date date := (now() AT TIME ZONE 'UTC')::date;
  primary_action jsonb := NULL;
  meetup_recs jsonb := '[]'::jsonb;
  veggie_recs jsonb := '[]'::jsonb;
  place_recs jsonb := '[]'::jsonb;
  used_meetup_ids uuid[] := ARRAY[]::uuid[];
  primary_entity_type text := NULL;
  primary_entity_id text := NULL;
BEGIN
  SELECT id, current_city, interests INTO me, my_city, my_interests
  FROM profiles WHERE auth_user_id = auth.uid();
  IF me IS NULL THEN
    RETURN jsonb_build_object(
      'generated_at', now_ts, 'primary_action', NULL,
      'meetup_recommendations','[]'::jsonb,'veggie_recommendations','[]'::jsonb,'place_recommendations','[]'::jsonb
    );
  END IF;

  -- 1) Active check-in
  SELECT jsonb_build_object(
    'action_type','open_check_in',
    'entity_type','meetup','entity_id', m.id::text,
    'title','You can check in now',
    'supporting_text', m.title,
    'reason_code','check_in_active','reason_label','Check-in window is open',
    'action_label','Check in',
    'secondary_action_label','View meetup',
    'time_context', to_char(m.start_time,'HH12:MI AM')
  )
  INTO primary_action
  FROM meetups m
  JOIN attendance a ON a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in','attended')
  WHERE m.status NOT IN ('cancelled','past')
    AND m.date = today_date
    AND a.checked_in_at IS NULL
    AND now_ts BETWEEN (m.date::timestamp + m.start_time - interval '30 minutes')
                   AND (m.date::timestamp + m.end_time + interval '60 minutes')
  ORDER BY m.start_time
  LIMIT 1;
  IF primary_action IS NOT NULL THEN
    primary_entity_type := 'meetup';
    primary_entity_id := primary_action->>'entity_id';
  END IF;

  -- 2) Starting soon
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','view_meetup',
      'entity_type','meetup','entity_id', m.id::text,
      'title','Your meetup starts soon',
      'supporting_text', m.title,
      'reason_code','starts_soon',
      'reason_label','Starts in ' || GREATEST(1, (EXTRACT(EPOCH FROM ((m.date::timestamp + m.start_time) - now_ts))/60)::int)::text || ' min',
      'action_label','View meetup',
      'time_context', to_char(m.start_time,'HH12:MI AM')
    )
    INTO primary_action
    FROM meetups m
    JOIN attendance a ON a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in')
    WHERE m.status NOT IN ('cancelled','past')
      AND (m.date::timestamp + m.start_time) BETWEEN now_ts AND (now_ts + interval '90 minutes')
    ORDER BY (m.date::timestamp + m.start_time)
    LIMIT 1;
    IF primary_action IS NOT NULL THEN
      primary_entity_type := 'meetup';
      primary_entity_id := primary_action->>'entity_id';
    END IF;
  END IF;

  -- 3) Pending invitation
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','respond_invitation',
      'entity_type','invitation','entity_id', mi.id::text,
      'title', sender.display_name || ' invited you to a meetup',
      'supporting_text', m.title,
      'reason_code','invitation_pending','reason_label','Awaiting your response',
      'action_label','Review invitation',
      'time_context', to_char(m.date,'Mon DD')
    )
    INTO primary_action
    FROM meetup_invitations mi
    JOIN meetups m ON m.id = mi.meetup_id
    JOIN profiles sender ON sender.id = mi.sender_id
    WHERE mi.recipient_id = me
      AND mi.status IN ('invited','viewed')
      AND mi.joined_at IS NULL
      AND m.status NOT IN ('cancelled','past')
      AND m.date >= today_date
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = mi.sender_id) OR (ub.blocker_profile_id = mi.sender_id AND ub.blocked_profile_id = me))
    ORDER BY mi.created_at DESC
    LIMIT 1;
  END IF;

  -- 4) Post-meetup follow-up
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','view_summary',
      'entity_type','meetup','entity_id', m.id::text,
      'title','See who you met',
      'supporting_text', m.title,
      'reason_code','post_meetup_follow_up','reason_label','From your recent meetup',
      'action_label','View summary',
      'time_context', to_char(m.date,'Mon DD')
    )
    INTO primary_action
    FROM attendance a
    JOIN meetups m ON m.id = a.meetup_id
    LEFT JOIN meetup_follow_up_state s ON s.meetup_id = m.id AND s.profile_id = me
    WHERE a.profile_id = me
      AND a.status IN ('attended','checked_in')
      AND m.date BETWEEN (today_date - 7) AND today_date
      AND m.status IN ('past','in_progress','upcoming')
      AND (s.viewed_at IS NULL AND s.dismissed_at IS NULL)
    ORDER BY m.date DESC, m.start_time DESC
    LIMIT 1;
    IF primary_action IS NOT NULL THEN
      primary_entity_type := 'meetup';
      primary_entity_id := primary_action->>'entity_id';
    END IF;
  END IF;

  -- 5) Pending connection request received
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','respond_connection',
      'entity_type','friendship','entity_id', f.id::text,
      'title', requester.display_name || ' wants to connect',
      'supporting_text','Review this connection request',
      'reason_code','connection_request','reason_label','Awaiting your response',
      'action_label','Review request'
    )
    INTO primary_action
    FROM friendships f
    JOIN profiles requester ON requester.id = f.requester_id
    WHERE f.status = 'pending'
      AND f.requester_id <> me
      AND (f.profile_a_id = me OR f.profile_b_id = me)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = f.requester_id) OR (ub.blocker_profile_id = f.requester_id AND ub.blocked_profile_id = me))
    ORDER BY f.created_at DESC
    LIMIT 1;
  END IF;

  -- 6) Happening today
  IF primary_action IS NULL THEN
    SELECT jsonb_build_object(
      'action_type','view_meetup',
      'entity_type','meetup','entity_id', m.id::text,
      'title','Your meetup is today',
      'supporting_text', m.title,
      'reason_code','happening_today','reason_label','Happening today',
      'action_label','View meetup',
      'time_context', to_char(m.start_time,'HH12:MI AM')
    )
    INTO primary_action
    FROM meetups m
    JOIN attendance a ON a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in')
    WHERE m.status NOT IN ('cancelled','past')
      AND m.date = today_date
    ORDER BY m.start_time
    LIMIT 1;
    IF primary_action IS NOT NULL THEN
      primary_entity_type := 'meetup';
      primary_entity_id := primary_action->>'entity_id';
    END IF;
  END IF;

  IF primary_entity_type = 'meetup' AND primary_entity_id IS NOT NULL THEN
    used_meetup_ids := array_append(used_meetup_ids, primary_entity_id::uuid);
  END IF;

  -- Meetup recommendations (top 3)
  WITH hidden AS (
    SELECT entity_id FROM recommendation_feedback
    WHERE profile_id = me AND surface='today' AND entity_type='meetup' AND expires_at > now_ts
  ),
  eligible AS (
    SELECT m.id, m.title, m.category, m.date, m.start_time, m.end_time, m.cover_image_url, m.host_id, m.capacity,
      (SELECT COUNT(*) FROM attendance a WHERE a.meetup_id = m.id AND a.status IN ('joined','checked_in','attended')) AS attendee_count,
      EXISTS (SELECT 1 FROM attendance a WHERE a.meetup_id = m.id AND a.profile_id = me AND a.status IN ('joined','checked_in','attended')) AS is_attending,
      EXISTS (SELECT 1 FROM attendance a WHERE a.meetup_id = m.id AND a.profile_id = me AND a.status = 'removed') AS is_removed,
      p.current_city AS host_city,
      (CASE WHEN m.date = today_date THEN 100
            WHEN m.date = today_date + 1 THEN 60
            WHEN m.date <= today_date + 7 THEN 40
            ELSE 20 END)
      + (CASE WHEN p.current_city IS NOT NULL AND my_city IS NOT NULL AND p.current_city = my_city THEN 30 ELSE 0 END)
      + (CASE WHEN m.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN 20 ELSE 0 END) AS score
    FROM meetups m
    JOIN profiles p ON p.id = m.host_id
    WHERE m.status NOT IN ('cancelled','past')
      AND (m.date > today_date OR (m.date = today_date AND m.end_time >= (now_ts AT TIME ZONE 'UTC')::time))
      AND m.host_id <> me
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = m.host_id) OR (ub.blocker_profile_id = m.host_id AND ub.blocked_profile_id = me))
      AND m.id <> ALL(used_meetup_ids)
      AND m.id::text NOT IN (SELECT entity_id FROM hidden)
  ),
  final AS (
    SELECT e.*,
      CASE
        WHEN e.date = today_date THEN 'happening_today'
        WHEN (e.date::timestamp + e.start_time) <= (now_ts + interval '90 minutes') THEN 'starts_soon'
        WHEN e.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN 'matches_your_interests'
        WHEN my_city IS NOT NULL AND e.host_city = my_city THEN 'in_your_city'
        ELSE 'new_meetup'
      END AS reason_code_calc
    FROM eligible e
    WHERE (e.is_attending OR (e.capacity > e.attendee_count))
      AND NOT e.is_removed
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, date, start_time, id), '[]'::jsonb) INTO meetup_recs
  FROM (
    SELECT f.id, f.score, f.date, f.start_time,
      jsonb_build_object(
        'entity_type','meetup','entity_id', f.id::text,
        'title', f.title,
        'category', f.category,
        'date', f.date,
        'start_time', f.start_time,
        'end_time', f.end_time,
        'cover_image_url', f.cover_image_url,
        'host_id', f.host_id::text,
        'attendee_count', f.attendee_count,
        'capacity', f.capacity,
        'is_attending', f.is_attending,
        'reason_code', f.reason_code_calc,
        'reason_label', CASE f.reason_code_calc
          WHEN 'happening_today' THEN 'Happening today'
          WHEN 'starts_soon' THEN 'Starting soon'
          WHEN 'matches_your_interests' THEN 'Matches your interests'
          WHEN 'in_your_city' THEN 'In ' || COALESCE(my_city,'your city')
          ELSE 'New meetup'
        END,
        'action_type', CASE WHEN f.is_attending THEN 'view_meetup' ELSE 'join_meetup' END
      ) AS row_json
    FROM final f
    ORDER BY score DESC, date, start_time, id
    LIMIT 3
  ) t;

  -- Track meetup ids used
  used_meetup_ids := COALESCE((
    SELECT array_agg((v->>'entity_id')::uuid) FROM jsonb_array_elements(meetup_recs) v
  ), ARRAY[]::uuid[]);
  IF primary_entity_type='meetup' AND primary_entity_id IS NOT NULL THEN
    used_meetup_ids := array_append(used_meetup_ids, primary_entity_id::uuid);
  END IF;

  -- Veggie recommendations
  -- CROSS-CITY RULE (WO-034D): a different-city profile may only appear when both
  -- users are confirmed active attendees of the same upcoming/active meetup located
  -- in the viewer's selected city (meetup city = host.current_city surrogate).
  -- The reason label for that case explicitly names the shared meetup.
  WITH hidden AS (
    SELECT entity_id FROM recommendation_feedback
    WHERE profile_id = me AND surface='today' AND entity_type='profile' AND expires_at > now_ts
  ),
  candidates AS (
    SELECT p.id, p.display_name, p.avatar_url, p.current_city, p.interests,
      (
        SELECT jsonb_build_object('id', m.id::text, 'title', m.title, 'date', m.date)
        FROM attendance a1
        JOIN attendance a2 ON a2.meetup_id = a1.meetup_id
        JOIN meetups m ON m.id = a1.meetup_id
        JOIN profiles host ON host.id = m.host_id
        WHERE a1.profile_id = me AND a2.profile_id = p.id
          AND a1.status IN ('joined','checked_in','attended')
          AND a2.status IN ('joined','checked_in','attended')
          AND m.status NOT IN ('cancelled','past')
          AND (m.date > today_date OR (m.date = today_date AND m.end_time >= (now_ts AT TIME ZONE 'UTC')::time))
          AND my_city IS NOT NULL
          AND host.current_city IS NOT NULL
          AND host.current_city = my_city
        ORDER BY m.date, m.start_time
        LIMIT 1
      ) AS shared_upcoming_meetup,
      cardinality(ARRAY(SELECT unnest(p.interests) INTERSECT SELECT unnest(COALESCE(my_interests, ARRAY[]::text[])))) AS shared_interest_count,
      (p.current_city IS NOT NULL AND my_city IS NOT NULL AND p.current_city = my_city) AS same_city
    FROM profiles p
    WHERE p.id <> me
      AND p.onboarding_completed = true
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_profile_id = me AND ub.blocked_profile_id = p.id) OR (ub.blocker_profile_id = p.id AND ub.blocked_profile_id = me))
      AND NOT EXISTS (SELECT 1 FROM friendships f
        WHERE f.status IN ('connected','verified','pending','blocked','removed')
        AND ((f.profile_a_id = me AND f.profile_b_id = p.id) OR (f.profile_a_id = p.id AND f.profile_b_id = me)))
      AND p.id::text NOT IN (SELECT entity_id FROM hidden)
  ),
  ranked AS (
    SELECT c.*,
      (CASE WHEN c.shared_upcoming_meetup IS NOT NULL THEN 60 ELSE 0 END
        + CASE WHEN c.same_city THEN c.shared_interest_count * 15 ELSE 0 END
        + CASE WHEN c.same_city THEN 20 ELSE 0 END) AS score,
      CASE
        WHEN c.shared_upcoming_meetup IS NOT NULL THEN 'same_meetup'
        WHEN c.same_city AND c.shared_interest_count > 0 THEN 'shared_interest'
        WHEN c.same_city THEN 'in_your_city'
        ELSE NULL
      END AS reason_code_calc,
      (SELECT i FROM unnest(c.interests) AS i
        WHERE i = ANY(COALESCE(my_interests, ARRAY[]::text[])) LIMIT 1) AS shared_interest_name
    FROM candidates c
    -- Different-city candidates require a valid shared upcoming meetup in viewer's city.
    -- Same-city candidates may qualify via shared meetup, shared interest, or city alone.
    WHERE c.shared_upcoming_meetup IS NOT NULL
       OR c.same_city
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, id), '[]'::jsonb) INTO veggie_recs
  FROM (
    SELECT r.id, r.score,
      jsonb_build_object(
        'entity_type','profile','entity_id', r.id::text,
        'display_name', r.display_name,
        'avatar_url', r.avatar_url,
        'current_city', r.current_city,
        'interests', to_jsonb(r.interests),
        'reason_code', r.reason_code_calc,
        'reason_label', CASE r.reason_code_calc
          WHEN 'same_meetup' THEN 'You’re both going to ' || (r.shared_upcoming_meetup->>'title')
          WHEN 'shared_interest' THEN 'Shares ' || COALESCE(r.shared_interest_name,'an interest')
          WHEN 'in_your_city' THEN 'In ' || COALESCE(my_city,'your city')
          ELSE 'New to VeggieMeet'
        END,
        'shared_meetup_id', r.shared_upcoming_meetup->>'id',
        'action_type','view_profile'
      ) AS row_json
    FROM ranked r
    WHERE r.reason_code_calc IS NOT NULL
    ORDER BY score DESC, id
    LIMIT 3
  ) t;

  -- Place recommendations (unchanged)
  WITH hidden AS (
    SELECT entity_id FROM recommendation_feedback
    WHERE profile_id = me AND surface='today' AND entity_type='place' AND expires_at > now_ts
  ),
  supported AS (
    SELECT DISTINCT community_place_id AS place_id FROM place_check_ins WHERE profile_id = me
  ),
  candidates AS (
    SELECT cp.id, cp.name, cp.category, cp.address, cp.cover_image_url, cp.upcoming_meetups_count,
      EXISTS (SELECT 1 FROM meetups m WHERE m.community_place_id = cp.id AND m.status NOT IN ('cancelled','past') AND m.date >= today_date) AS has_upcoming,
      (cp.id::text IN (SELECT place_id FROM supported)) AS supported_by_me
    FROM community_places cp
    WHERE cp.id::text NOT IN (SELECT entity_id FROM hidden)
  ),
  ranked AS (
    SELECT c.*,
      (CASE WHEN c.has_upcoming THEN 60 ELSE 0 END
       + CASE WHEN NOT c.supported_by_me THEN 30 ELSE 5 END
       + CASE WHEN c.upcoming_meetups_count > 0 THEN 10 ELSE 0 END) AS score,
      CASE
        WHEN c.has_upcoming THEN 'upcoming_meetup_here'
        WHEN NOT c.supported_by_me THEN 'new_place'
        ELSE 'community_place'
      END AS reason_code_calc
    FROM candidates c
    WHERE (NOT c.supported_by_me) OR c.has_upcoming
  )
  SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, id), '[]'::jsonb) INTO place_recs
  FROM (
    SELECT r.id, r.score,
      jsonb_build_object(
        'entity_type','place','entity_id', r.id::text,
        'name', r.name,
        'category', r.category,
        'address', r.address,
        'cover_image_url', r.cover_image_url,
        'reason_code', r.reason_code_calc,
        'reason_label', CASE r.reason_code_calc
          WHEN 'upcoming_meetup_here' THEN 'Upcoming meetup here'
          WHEN 'new_place' THEN 'You haven’t supported this Place yet'
          ELSE 'Community Place'
        END,
        'action_type','view_place'
      ) AS row_json
    FROM ranked r
    ORDER BY score DESC, id
    LIMIT 3
  ) t;

  RETURN jsonb_build_object(
    'generated_at', now_ts,
    'selected_city', my_city,
    'primary_action', primary_action,
    'meetup_recommendations', COALESCE(meetup_recs,'[]'::jsonb),
    'veggie_recommendations', COALESCE(veggie_recs,'[]'::jsonb),
    'place_recommendations', COALESCE(place_recs,'[]'::jsonb)
  );
END $function$;