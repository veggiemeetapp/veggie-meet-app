-- D2: gate _insert_notification on the recipient's per-category preference.
CREATE OR REPLACE FUNCTION public._insert_notification(_recipient uuid, _actor uuid, _type notification_type, _entity_type text, _entity_id uuid, _destination_type text, _destination_id uuid, _title text, _body text, _metadata jsonb, _dedup_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref_col text;
  v_enabled boolean;
BEGIN
  IF _actor IS NOT NULL AND _actor = _recipient THEN RETURN; END IF;
  IF _recipient IS NULL THEN RETURN; END IF;

  v_pref_col := CASE _type
    WHEN 'connection_request_received' THEN 'connection_requests'
    WHEN 'connection_request_accepted' THEN 'connection_accepted'
    WHEN 'meetup_invitation_received'  THEN 'meetup_invitations'
    WHEN 'meetup_invitation_joined'    THEN 'meetup_invitations'
    WHEN 'meetup_updated'              THEN 'meetup_updates'
    WHEN 'meetup_cancelled'            THEN 'meetup_updates'
    WHEN 'meetup_attendee_removed'     THEN 'meetup_updates'
    ELSE NULL
  END;

  IF v_pref_col IS NOT NULL THEN
    EXECUTE format(
      'SELECT COALESCE((SELECT %I FROM public.notification_preferences WHERE profile_id = $1), TRUE)',
      v_pref_col
    ) INTO v_enabled USING _recipient;
    IF v_enabled IS FALSE THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, actor_id, type, entity_type, entity_id,
    destination_type, destination_id, title, body, metadata, dedup_key
  ) VALUES (
    _recipient, _actor, _type, _entity_type, _entity_id,
    _destination_type, _destination_id, _title, _body, COALESCE(_metadata,'{}'::jsonb), _dedup_key
  )
  ON CONFLICT (recipient_id, dedup_key) DO NOTHING;
END;
$function$;

-- D3: server-side discovery_visible filter in search_veggies (only for strangers).
CREATE OR REPLACE FUNCTION public.search_veggies(_query text, _city_id uuid DEFAULT NULL::uuid, _include_all_cities boolean DEFAULT false, _interests text[] DEFAULT NULL::text[], _relationship text[] DEFAULT NULL::text[], _limit integer DEFAULT 20, _cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _me uuid;
  _me_city uuid;
  _q text := public.search_norm(_query);
  _limit_clamped int := LEAST(GREATEST(coalesce(_limit, 20), 1), 20);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
BEGIN
  SELECT p.id, p.home_city_id INTO _me, _me_city
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid();
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  IF _cursor IS NOT NULL AND position(':' IN _cursor) > 0 THEN
    _cur_score := split_part(_cursor, ':', 1)::numeric;
    _cur_id := split_part(_cursor, ':', 2)::uuid;
  END IF;

  WITH blocks AS (
    SELECT CASE WHEN b.blocker_profile_id = _me THEN b.blocked_profile_id ELSE b.blocker_profile_id END AS other_id
    FROM public.user_blocks b
    WHERE b.blocker_profile_id = _me OR b.blocked_profile_id = _me
  ),
  my_upcoming AS (
    SELECT a.meetup_id, m.title
    FROM public.attendance a
    JOIN public.meetups m ON m.id = a.meetup_id
    WHERE a.profile_id = _me
      AND a.status NOT IN ('cancelled','removed')
      AND m.date >= CURRENT_DATE
      AND m.status <> 'cancelled'
  ),
  candidates AS (
    SELECT
      p.id, p.display_name, p.avatar_url, p.bio, p.interests, p.is_active_host, p.home_city_id,
      COALESCE(c.name, NULLIF(p.current_city, '')) AS city_name,
      p.discovery_visible
    FROM public.profiles p
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE p.id <> _me
      AND p.auth_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.other_id = p.id)
      AND (
        _q = '' OR (
          public.search_norm(p.display_name) LIKE '%'||_q||'%'
          OR public.search_norm(p.bio) LIKE '%'||_q||'%'
          OR EXISTS (SELECT 1 FROM unnest(coalesce(p.interests,'{}')) AS i(v) WHERE public.search_norm(i.v) LIKE '%'||_q||'%')
        )
      )
      AND (_include_all_cities OR _city_id IS NULL OR p.home_city_id = _city_id)
      AND (_interests IS NULL OR array_length(_interests,1) IS NULL OR p.interests && _interests)
  ),
  scored AS (
    SELECT c.*,
      (
        CASE WHEN _q <> '' AND public.search_norm(c.display_name) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(c.display_name) LIKE _q||'%' THEN 700
             ELSE 0 END
        + CASE WHEN EXISTS (
            SELECT 1 FROM public.attendance a
            JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
            WHERE a.profile_id = c.id AND a.status NOT IN ('cancelled','removed')
          ) THEN 400 ELSE 0 END
        + LEAST(
            COALESCE(array_length(
              (SELECT array_agg(x) FROM unnest(c.interests) x
                WHERE EXISTS (
                  SELECT 1 FROM public.profiles me2
                  WHERE me2.id = _me AND lower(x) = ANY(SELECT lower(v) FROM unnest(coalesce(me2.interests,'{}')) v)
                )
              ), 1
            ), 0) * 40,
            120
          )
        + CASE WHEN _city_id IS NOT NULL AND c.home_city_id = _city_id THEN 60 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(c.bio) LIKE '%'||_q||'%' THEN 20 ELSE 0 END
      )::numeric AS score
    FROM candidates c
  ),
  rel AS (
    SELECT s.id AS other_id, f.id AS friendship_id, f.status, f.requester_id
    FROM scored s
    LEFT JOIN LATERAL (
      SELECT id, status, requester_id FROM public.friendships
      WHERE (profile_a_id = LEAST(_me, s.id) AND profile_b_id = GREATEST(_me, s.id))
      LIMIT 1
    ) f ON true
  ),
  ranked AS (
    SELECT s.*,
      COALESCE(r.status::text, 'none') AS rel_status,
      r.requester_id, r.friendship_id,
      (SELECT string_agg(t, ', ') FROM (
        SELECT x AS t FROM unnest(s.interests) x
        WHERE EXISTS (SELECT 1 FROM public.profiles me3 WHERE me3.id = _me AND lower(x) = ANY(SELECT lower(v) FROM unnest(coalesce(me3.interests,'{}')) v))
        LIMIT 2
      ) t) AS shared_interests_label,
      (SELECT mu.title FROM public.attendance a JOIN my_upcoming mu ON mu.meetup_id = a.meetup_id
        WHERE a.profile_id = s.id AND a.status NOT IN ('cancelled','removed') LIMIT 1) AS shared_meetup_title
    FROM scored s
    LEFT JOIN rel r ON r.other_id = s.id
    WHERE (
      _relationship IS NULL OR array_length(_relationship,1) IS NULL
      OR COALESCE(CASE WHEN r.status = 'pending' THEN 'pending'
             WHEN r.status IN ('connected','verified') THEN r.status::text
             ELSE 'none' END, 'none') = ANY(_relationship)
    )
    AND (_cur_score IS NULL OR (score, s.id) < (_cur_score, _cur_id))
    -- Server-side discovery_visible: hide from strangers only.
    AND (s.discovery_visible IS TRUE OR COALESCE(r.status::text, 'none') <> 'none')
  )
  SELECT jsonb_agg(item ORDER BY score DESC, id ASC) INTO _items
  FROM (
    SELECT jsonb_build_object(
      'entity_type', 'veggie',
      'entity_id', ranked.id,
      'display_name', ranked.display_name,
      'avatar_url', ranked.avatar_url,
      'bio', ranked.bio,
      'interests', ranked.interests,
      'is_active_host', ranked.is_active_host,
      'city_name', ranked.city_name,
      'home_city_id', ranked.home_city_id,
      'shared_interests_label', ranked.shared_interests_label,
      'shared_meetup_title', ranked.shared_meetup_title,
      'relationship', ranked.rel_status,
      'friendship_id', ranked.friendship_id,
      'requester_id', ranked.requester_id,
      'score', ranked.score
    ) AS item, ranked.score, ranked.id
    FROM ranked
    ORDER BY score DESC, id ASC
    LIMIT _limit_clamped
  ) sub;

  IF _items IS NULL OR jsonb_array_length(_items) < _limit_clamped THEN
    _next := NULL;
  ELSE
    SELECT (elem->>'score')::text || ':' || (elem->>'entity_id')::text
    INTO _next
    FROM jsonb_array_elements(_items) elem
    ORDER BY (elem->>'score')::numeric ASC, (elem->>'entity_id')::uuid DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object('items', COALESCE(_items, '[]'::jsonb), 'next_cursor', _next);
END;
$function$;