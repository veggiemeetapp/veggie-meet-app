-- ============================================================
-- WO-069 Direct Messaging & Conversation Privacy Integrity
-- ============================================================

-- 1. Remove member write privileges: DM writes become RPC-only.
REVOKE INSERT ON public.dm_conversations FROM authenticated;
REVOKE INSERT, UPDATE ON public.dm_messages FROM authenticated;

DROP POLICY IF EXISTS dm_conversations_participant_insert ON public.dm_conversations;
DROP POLICY IF EXISTS dm_messages_participant_insert ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_recipient_read_update ON public.dm_messages;

-- Participant-only SELECT remains (needed for reads + scoped realtime).
GRANT SELECT ON public.dm_conversations TO authenticated;
GRANT SELECT ON public.dm_messages TO authenticated;
GRANT ALL ON public.dm_conversations TO service_role;
GRANT ALL ON public.dm_messages TO service_role;

-- 2. Race-safe canonical conversation creation.
CREATE OR REPLACE FUNCTION public.get_or_create_dm(_other_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me UUID; a UUID; b UUID; conv_id UUID;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _other_profile_id IS NULL OR _other_profile_id = me THEN
    RAISE EXCEPTION 'Invalid recipient';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _other_profile_id) THEN
    RAISE EXCEPTION 'Invalid recipient';
  END IF;
  IF public.is_blocked_between(me, _other_profile_id) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;
  IF NOT public.are_connected(me, _other_profile_id) THEN
    RAISE EXCEPTION 'You must be connected to message this Veggie';
  END IF;

  a := LEAST(me, _other_profile_id);
  b := GREATEST(me, _other_profile_id);

  INSERT INTO public.dm_conversations (user_a_id, user_b_id)
  VALUES (a, b)
  ON CONFLICT (user_a_id, user_b_id) DO NOTHING
  RETURNING id INTO conv_id;

  IF conv_id IS NULL THEN
    SELECT id INTO conv_id FROM public.dm_conversations
     WHERE user_a_id = a AND user_b_id = b;
  END IF;

  RETURN conv_id;
END; $$;

-- 3. Server-authoritative message send.
CREATE OR REPLACE FUNCTION public.send_dm_message(_conversation_id uuid, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me UUID; conv RECORD; peer UUID; clean TEXT; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  clean := btrim(coalesce(_body, ''));
  IF clean = '' THEN RAISE EXCEPTION 'Message can''t be empty'; END IF;
  IF length(clean) > 2000 THEN RAISE EXCEPTION 'Messages must be under 2000 characters'; END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = _conversation_id FOR UPDATE;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  peer := CASE WHEN me = conv.user_a_id THEN conv.user_b_id ELSE conv.user_a_id END;
  IF public.is_blocked_between(me, peer) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;
  IF NOT public.are_connected(me, peer) THEN
    RAISE EXCEPTION 'You can only message connected Veggies';
  END IF;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body)
  VALUES (_conversation_id, me, clean)
  RETURNING id, conversation_id, sender_id, body, created_at, read_at, invitation_id
  INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id,
    'conversation_id', row_out.conversation_id,
    'sender_id', row_out.sender_id,
    'body', row_out.body,
    'created_at', row_out.created_at,
    'read_at', row_out.read_at,
    'invitation_id', row_out.invitation_id
  );
END; $$;

-- 4. Single-query inbox (no N+1), block-suppressed both directions.
CREATE OR REPLACE FUNCTION public.get_my_dm_inbox()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT public.current_profile_id() AS id)
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'last_message_at' DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'conversation_id', c.id,
             'peer_profile_id', p.id,
             'display_name', p.display_name,
             'avatar_url', p.avatar_url,
             'city', p.current_city,
             'is_verified_connection', coalesce(f.status = 'verified', false),
             'last_message_body', lm.body,
             'last_message_at', coalesce(lm.created_at, c.last_message_at),
             'last_sender_id', lm.sender_id,
             'unread_count', coalesce(uc.n, 0)
           ) AS x
    FROM public.dm_conversations c
    JOIN me ON true
    JOIN public.profiles p
      ON p.id = CASE WHEN c.user_a_id = me.id THEN c.user_b_id ELSE c.user_a_id END
    LEFT JOIN public.friendships f
      ON f.profile_a_id = LEAST(me.id, p.id) AND f.profile_b_id = GREATEST(me.id, p.id)
    LEFT JOIN LATERAL (
      SELECT m.body, m.created_at, m.sender_id
        FROM public.dm_messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM public.dm_messages m
       WHERE m.conversation_id = c.id
         AND m.sender_id <> me.id
         AND m.read_at IS NULL
    ) uc ON true
    WHERE me.id IS NOT NULL
      AND (c.user_a_id = me.id OR c.user_b_id = me.id)
      AND NOT public.is_blocked_between(me.id, p.id)
  ) s;
$$;

-- 5. Bounded, deterministic thread pagination (oldest-first page window).
CREATE OR REPLACE FUNCTION public.get_dm_thread(
  _conversation_id uuid,
  _before_created_at timestamptz DEFAULT NULL,
  _before_id uuid DEFAULT NULL,
  _limit integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me UUID; conv RECORD; peer_row RECORD; lim INT; msgs jsonb; has_more BOOLEAN;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  lim := LEAST(GREATEST(coalesce(_limit, 40), 1), 50);

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = _conversation_id;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  SELECT p.id, p.display_name, p.avatar_url, p.current_city,
         coalesce(f.status = 'verified', false) AS verified
    INTO peer_row
    FROM public.profiles p
    LEFT JOIN public.friendships f
      ON f.profile_a_id = LEAST(me, p.id) AND f.profile_b_id = GREATEST(me, p.id)
   WHERE p.id = CASE WHEN conv.user_a_id = me THEN conv.user_b_id ELSE conv.user_a_id END;

  WITH page AS (
    SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.read_at, m.invitation_id
      FROM public.dm_messages m
     WHERE m.conversation_id = _conversation_id
       AND (
         _before_created_at IS NULL
         OR (m.created_at, m.id) < (_before_created_at, coalesce(_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
       )
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT lim + 1
  ), trimmed AS (
    SELECT * FROM page ORDER BY created_at DESC, id DESC LIMIT lim
  )
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at ASC, t.id ASC), '[]'::jsonb),
         (SELECT count(*) FROM page) > lim
    INTO msgs, has_more
    FROM trimmed t;

  RETURN jsonb_build_object(
    'conversation_id', conv.id,
    'peer', jsonb_build_object(
      'profile_id', peer_row.id,
      'display_name', peer_row.display_name,
      'avatar_url', peer_row.avatar_url,
      'city', peer_row.current_city,
      'is_verified_connection', peer_row.verified
    ),
    'can_send', public.are_connected(me, peer_row.id)
                AND NOT public.is_blocked_between(me, peer_row.id),
    'is_blocked', public.is_blocked_between(me, peer_row.id),
    'is_connected', public.are_connected(me, peer_row.id),
    'has_more', has_more,
    'messages', msgs
  );
END; $$;

-- 6. Execution scoping: signed-in members only.
REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_dm_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_dm_inbox() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dm_thread(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_dm_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_dm_inbox() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dm_thread(uuid, timestamptz, uuid, integer) TO authenticated;