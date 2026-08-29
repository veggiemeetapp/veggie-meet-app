-- WO-137 — emoji reactions for chat messages

CREATE OR REPLACE FUNCTION public.is_approved_reaction_emoji(_emoji text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT _emoji IN ('👍','❤️','😂','🎉','😮','🙏');
$$;

CREATE TABLE public.dm_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.dm_messages(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (public.is_approved_reaction_emoji(emoji)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, profile_id, emoji)
);
GRANT ALL ON public.dm_message_reactions TO service_role;
ALTER TABLE public.dm_message_reactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX dm_message_reactions_message_idx ON public.dm_message_reactions(message_id);

CREATE TABLE public.meetup_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (public.is_approved_reaction_emoji(emoji)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, profile_id, emoji)
);
GRANT ALL ON public.meetup_message_reactions TO service_role;
ALTER TABLE public.meetup_message_reactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX meetup_message_reactions_message_idx ON public.meetup_message_reactions(message_id);

-- Realtime signal: existing subscriptions already listen to UPDATEs on the
-- message tables, so reaction changes converge without exposing reactor ids.
ALTER TABLE public.dm_messages ADD COLUMN IF NOT EXISTS reactions_updated_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reactions_updated_at timestamptz;

-- Member-safe summaries: emoji, aggregate count, viewer flag. No reactor identity.
CREATE OR REPLACE FUNCTION public.dm_reaction_summary(_message_id uuid, _me uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('emoji', s.emoji, 'count', s.cnt, 'mine', s.mine)
                            ORDER BY s.first_at, s.emoji), '[]'::jsonb)
  FROM (
    SELECT r.emoji, count(*)::int AS cnt, bool_or(r.profile_id = _me) AS mine,
           min(r.created_at) AS first_at
      FROM public.dm_message_reactions r
     WHERE r.message_id = _message_id
     GROUP BY r.emoji
  ) s;
$$;
REVOKE ALL ON FUNCTION public.dm_reaction_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meetup_reaction_summary(_message_id uuid, _me uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('emoji', s.emoji, 'count', s.cnt, 'mine', s.mine)
                            ORDER BY s.first_at, s.emoji), '[]'::jsonb)
  FROM (
    SELECT r.emoji, count(*)::int AS cnt, bool_or(r.profile_id = _me) AS mine,
           min(r.created_at) AS first_at
      FROM public.meetup_message_reactions r
     WHERE r.message_id = _message_id
     GROUP BY r.emoji
  ) s;
$$;
REVOKE ALL ON FUNCTION public.meetup_reaction_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;

/* ---------------- toggles ---------------- */

CREATE OR REPLACE FUNCTION public.toggle_dm_message_reaction(_message_id uuid, _emoji text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid; msg RECORD; conv RECORD; removed int; added boolean := false;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_approved_reaction_emoji(_emoji) THEN
    RAISE EXCEPTION 'That reaction is not available';
  END IF;

  SELECT id, conversation_id, deleted_at INTO msg
    FROM public.dm_messages WHERE id = _message_id;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = msg.conversation_id;
  IF conv.id IS NULL OR (me <> conv.user_a_id AND me <> conv.user_b_id) THEN
    RAISE EXCEPTION 'This conversation is not available';
  END IF;

  DELETE FROM public.dm_message_reactions
   WHERE message_id = _message_id AND profile_id = me AND emoji = _emoji;
  GET DIAGNOSTICS removed = ROW_COUNT;

  IF removed = 0 THEN
    INSERT INTO public.dm_message_reactions (message_id, profile_id, emoji)
    VALUES (_message_id, me, _emoji)
    ON CONFLICT (message_id, profile_id, emoji) DO NOTHING;
    added := true;
  END IF;

  UPDATE public.dm_messages SET reactions_updated_at = now() WHERE id = _message_id;

  RETURN jsonb_build_object(
    'message_id', _message_id,
    'emoji', _emoji,
    'reacted', added,
    'reactions', public.dm_reaction_summary(_message_id, me)
  );
END; $$;
REVOKE ALL ON FUNCTION public.toggle_dm_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_dm_message_reaction(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_meetup_message_reaction(_message_id uuid, _emoji text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid; msg RECORD; removed int; added boolean := false;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_approved_reaction_emoji(_emoji) THEN
    RAISE EXCEPTION 'That reaction is not available';
  END IF;

  SELECT id, chat_id, type, deleted_at INTO msg
    FROM public.messages WHERE id = _message_id;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.type <> 'user' THEN RAISE EXCEPTION 'This message can''t be reacted to'; END IF;
  IF NOT public.can_read_meetup_chat(msg.chat_id) THEN
    RAISE EXCEPTION 'This chat is not available';
  END IF;
  IF public.meetup_chat_post_block_reason(msg.chat_id) = 'not_participant' THEN
    RAISE EXCEPTION 'This chat is not available';
  END IF;

  DELETE FROM public.meetup_message_reactions
   WHERE message_id = _message_id AND profile_id = me AND emoji = _emoji;
  GET DIAGNOSTICS removed = ROW_COUNT;

  IF removed = 0 THEN
    INSERT INTO public.meetup_message_reactions (message_id, profile_id, emoji)
    VALUES (_message_id, me, _emoji)
    ON CONFLICT (message_id, profile_id, emoji) DO NOTHING;
    added := true;
  END IF;

  UPDATE public.messages SET reactions_updated_at = now() WHERE id = _message_id;

  RETURN jsonb_build_object(
    'message_id', _message_id,
    'emoji', _emoji,
    'reacted', added,
    'reactions', public.meetup_reaction_summary(_message_id, me)
  );
END; $$;
REVOKE ALL ON FUNCTION public.toggle_meetup_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_meetup_message_reaction(uuid, text) TO authenticated;

/* ---------------- bulk read for realtime refresh ---------------- */

CREATE OR REPLACE FUNCTION public.get_dm_message_reactions(_conversation_id uuid, _message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid; conv RECORD; out jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = _conversation_id;
  IF conv.id IS NULL OR (me <> conv.user_a_id AND me <> conv.user_b_id) THEN
    RAISE EXCEPTION 'This conversation is not available';
  END IF;

  SELECT coalesce(jsonb_object_agg(m.id::text, public.dm_reaction_summary(m.id, me)), '{}'::jsonb)
    INTO out
    FROM public.dm_messages m
   WHERE m.conversation_id = _conversation_id
     AND m.deleted_at IS NULL
     AND (_message_ids IS NULL OR m.id = ANY(_message_ids));
  RETURN out;
END; $$;
REVOKE ALL ON FUNCTION public.get_dm_message_reactions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dm_message_reactions(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_meetup_message_reactions(_chat_id uuid, _message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid; out jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_read_meetup_chat(_chat_id) THEN
    RAISE EXCEPTION 'This chat is not available';
  END IF;

  SELECT coalesce(jsonb_object_agg(m.id::text, public.meetup_reaction_summary(m.id, me)), '{}'::jsonb)
    INTO out
    FROM public.messages m
   WHERE m.chat_id = _chat_id
     AND m.deleted_at IS NULL
     AND m.type = 'user'
     AND (_message_ids IS NULL OR m.id = ANY(_message_ids));
  RETURN out;
END; $$;
REVOKE ALL ON FUNCTION public.get_meetup_message_reactions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meetup_message_reactions(uuid, uuid[]) TO authenticated;

/* ---------------- thread reads now carry reaction summaries ---------------- */

CREATE OR REPLACE FUNCTION public.get_dm_thread(_conversation_id uuid, _before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT m.id, m.conversation_id, m.sender_id,
           CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.body END AS body,
           m.created_at, m.read_at,
           CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.invitation_id END AS invitation_id,
           m.edited_at, m.deleted_at,
           (m.deleted_at IS NOT NULL) AS is_deleted,
           CASE WHEN m.deleted_at IS NOT NULL THEN '[]'::jsonb
                ELSE public.dm_reaction_summary(m.id, me) END AS reactions
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
END; $function$;

CREATE OR REPLACE FUNCTION public.get_meetup_chat_thread(_chat_id uuid, _before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; lim integer; suppressed uuid[]; rows_out jsonb; got integer;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_read_meetup_chat(_chat_id) THEN
    RAISE EXCEPTION 'This chat is not available';
  END IF;
  lim := LEAST(GREATEST(COALESCE(_limit, 40), 1), 50);
  suppressed := public.get_my_suppressed_profile_ids();

  WITH page AS (
    SELECT msg.id, msg.chat_id, msg.sender_id, msg.body, msg.type, msg.created_at,
           msg.edited_at, msg.deleted_at
      FROM public.messages msg
     WHERE msg.chat_id = _chat_id
       AND (
         _before_created_at IS NULL
         OR msg.created_at < _before_created_at
         OR (msg.created_at = _before_created_at AND msg.id < _before_id)
       )
     ORDER BY msg.created_at DESC, msg.id DESC
     LIMIT lim
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at'), (x->>'id')), '[]'::jsonb),
         count(*)
    INTO rows_out, got
    FROM (
      SELECT jsonb_build_object(
               'id', p.id,
               'chat_id', p.chat_id,
               'sender_id', p.sender_id,
               'type', p.type,
               'created_at', p.created_at,
               'edited_at', CASE WHEN p.deleted_at IS NOT NULL THEN NULL ELSE p.edited_at END,
               'deleted_at', p.deleted_at,
               'is_deleted', p.deleted_at IS NOT NULL,
               'is_mine', p.sender_id = me,
               'is_suppressed', p.sender_id IS NOT NULL AND p.sender_id = ANY(suppressed),
               'reactions', CASE
                         WHEN p.deleted_at IS NOT NULL OR p.type <> 'user' THEN '[]'::jsonb
                         ELSE public.meetup_reaction_summary(p.id, me) END,
               'body', CASE
                         WHEN p.deleted_at IS NOT NULL THEN NULL
                         WHEN p.sender_id IS NOT NULL AND p.sender_id = ANY(suppressed)
                           THEN NULL ELSE p.body END,
               'sender_name', CASE
                         WHEN p.sender_id IS NULL THEN NULL
                         WHEN p.sender_id = ANY(suppressed) THEN NULL
                         ELSE pr.display_name END,
               'sender_avatar_url', CASE
                         WHEN p.sender_id IS NULL OR p.sender_id = ANY(suppressed)
                           THEN NULL ELSE pr.avatar_url END
             ) AS x
        FROM page p
        LEFT JOIN public.profiles pr ON pr.id = p.sender_id
    ) s;

  RETURN jsonb_build_object(
    'messages', rows_out,
    'has_more', got >= lim
  );
END;
$function$;

/* ---------------- deletion clears reactions ---------------- */

CREATE OR REPLACE FUNCTION public.delete_dm_message(_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; msg RECORD; conv RECORD; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, conversation_id, sender_id, body, deleted_at
    INTO msg FROM public.dm_messages WHERE id = _message_id FOR UPDATE;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.sender_id <> me THEN RAISE EXCEPTION 'You can only delete your own messages'; END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = msg.conversation_id;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  IF msg.deleted_at IS NOT NULL THEN
    DELETE FROM public.dm_message_reactions WHERE message_id = msg.id;
    RETURN jsonb_build_object(
      'id', msg.id, 'conversation_id', msg.conversation_id, 'sender_id', msg.sender_id,
      'body', NULL, 'deleted_at', msg.deleted_at, 'reactions', '[]'::jsonb,
      'already_deleted', true
    );
  END IF;

  INSERT INTO public.chat_message_deletions (source, message_id, sender_id, deleted_by, original_body)
  VALUES ('dm_message', msg.id, msg.sender_id, me, msg.body)
  ON CONFLICT (source, message_id) DO NOTHING;

  DELETE FROM public.dm_message_reactions WHERE message_id = msg.id;

  UPDATE public.dm_messages
     SET body = '', deleted_at = now(), edited_at = NULL, reactions_updated_at = now()
   WHERE id = _message_id
  RETURNING id, conversation_id, sender_id, created_at, read_at, deleted_at
    INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id,
    'conversation_id', row_out.conversation_id,
    'sender_id', row_out.sender_id,
    'body', NULL,
    'created_at', row_out.created_at,
    'read_at', row_out.read_at,
    'invitation_id', NULL,
    'edited_at', NULL,
    'deleted_at', row_out.deleted_at,
    'reactions', '[]'::jsonb,
    'already_deleted', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_meetup_chat_message(_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; msg RECORD; reason text; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, chat_id, sender_id, body, type, created_at, deleted_at
    INTO msg FROM public.messages WHERE id = _message_id FOR UPDATE;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.type <> 'user' THEN RAISE EXCEPTION 'This message can''t be deleted'; END IF;
  IF msg.sender_id IS NULL OR msg.sender_id <> me THEN
    RAISE EXCEPTION 'You can only delete your own messages';
  END IF;
  IF NOT public.can_read_meetup_chat(msg.chat_id) THEN
    RAISE EXCEPTION 'This chat is not available';
  END IF;

  IF msg.deleted_at IS NOT NULL THEN
    DELETE FROM public.meetup_message_reactions WHERE message_id = msg.id;
    RETURN jsonb_build_object(
      'id', msg.id, 'chat_id', msg.chat_id, 'sender_id', msg.sender_id,
      'body', NULL, 'type', msg.type, 'created_at', msg.created_at,
      'edited_at', NULL, 'deleted_at', msg.deleted_at,
      'is_mine', true, 'is_suppressed', false, 'is_deleted', true,
      'reactions', '[]'::jsonb, 'already_deleted', true
    );
  END IF;

  reason := public.meetup_chat_post_block_reason(msg.chat_id);
  IF reason = 'not_participant' THEN RAISE EXCEPTION 'This chat is not available'; END IF;

  INSERT INTO public.chat_message_deletions (source, message_id, sender_id, deleted_by, original_body)
  VALUES ('meetup_message', msg.id, msg.sender_id, me, msg.body)
  ON CONFLICT (source, message_id) DO NOTHING;

  DELETE FROM public.meetup_message_reactions WHERE message_id = msg.id;

  UPDATE public.messages
     SET body = '', deleted_at = now(), edited_at = NULL, reactions_updated_at = now()
   WHERE id = _message_id
  RETURNING id, chat_id, sender_id, type, created_at, deleted_at
    INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id, 'chat_id', row_out.chat_id, 'sender_id', row_out.sender_id,
    'body', NULL, 'type', row_out.type, 'created_at', row_out.created_at,
    'edited_at', NULL, 'deleted_at', row_out.deleted_at,
    'is_mine', true, 'is_suppressed', false, 'is_deleted', true,
    'reactions', '[]'::jsonb, 'already_deleted', false
  );
END;
$function$;