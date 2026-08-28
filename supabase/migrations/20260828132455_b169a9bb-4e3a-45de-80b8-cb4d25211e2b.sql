-- WO-136: member edit/delete of own chat messages -------------------------

ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Private retention of pre-deletion content for existing safety/moderation
-- records (user_reports.reported_message_id). No member-facing role can read it.
CREATE TABLE IF NOT EXISTS public.chat_message_deletions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('dm_message', 'meetup_message')),
  message_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  deleted_by uuid NOT NULL,
  original_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, message_id)
);

GRANT ALL ON public.chat_message_deletions TO service_role;

ALTER TABLE public.chat_message_deletions ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: retention store is closed to anon/authenticated.

-- ---------------------------------------------------------------- DM edit ---
CREATE OR REPLACE FUNCTION public.edit_dm_message(_message_id uuid, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid; msg RECORD; conv RECORD; peer uuid; clean text; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  clean := btrim(coalesce(_body, ''));
  IF clean = '' THEN RAISE EXCEPTION 'Message can''t be empty'; END IF;
  IF length(clean) > 2000 THEN RAISE EXCEPTION 'Messages must be under 2000 characters'; END IF;

  SELECT id, conversation_id, sender_id, deleted_at, invitation_id
    INTO msg FROM public.dm_messages WHERE id = _message_id FOR UPDATE;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This message was deleted'; END IF;
  IF msg.sender_id <> me THEN RAISE EXCEPTION 'You can only edit your own messages'; END IF;
  IF msg.invitation_id IS NOT NULL THEN RAISE EXCEPTION 'Invitations can''t be edited'; END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = msg.conversation_id;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  peer := CASE WHEN me = conv.user_a_id THEN conv.user_b_id ELSE conv.user_a_id END;
  IF public.is_blocked_between(me, peer) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;

  UPDATE public.dm_messages
     SET body = clean, edited_at = now()
   WHERE id = _message_id
  RETURNING id, conversation_id, sender_id, body, created_at, read_at,
            invitation_id, edited_at, deleted_at
    INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id,
    'conversation_id', row_out.conversation_id,
    'sender_id', row_out.sender_id,
    'body', row_out.body,
    'created_at', row_out.created_at,
    'read_at', row_out.read_at,
    'invitation_id', row_out.invitation_id,
    'edited_at', row_out.edited_at,
    'deleted_at', row_out.deleted_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_dm_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_dm_message(uuid, text) TO authenticated;

-- -------------------------------------------------------------- DM delete ---
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
    RETURN jsonb_build_object(
      'id', msg.id, 'conversation_id', msg.conversation_id, 'sender_id', msg.sender_id,
      'body', NULL, 'deleted_at', msg.deleted_at, 'already_deleted', true
    );
  END IF;

  INSERT INTO public.chat_message_deletions (source, message_id, sender_id, deleted_by, original_body)
  VALUES ('dm_message', msg.id, msg.sender_id, me, msg.body)
  ON CONFLICT (source, message_id) DO NOTHING;

  UPDATE public.dm_messages
     SET body = '', deleted_at = now(), edited_at = NULL
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
    'already_deleted', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_dm_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_dm_message(uuid) TO authenticated;

-- ------------------------------------------------- meetup chat edit/delete --
CREATE OR REPLACE FUNCTION public.edit_meetup_chat_message(_message_id uuid, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid; msg RECORD; clean text; reason text; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  clean := btrim(coalesce(_body, ''));
  IF clean = '' THEN RAISE EXCEPTION 'Message can''t be empty'; END IF;
  IF length(clean) > 2000 THEN RAISE EXCEPTION 'Messages must be under 2000 characters'; END IF;

  SELECT id, chat_id, sender_id, type, deleted_at
    INTO msg FROM public.messages WHERE id = _message_id FOR UPDATE;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'This message is no longer available'; END IF;
  IF msg.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This message was deleted'; END IF;
  IF msg.type <> 'user' THEN RAISE EXCEPTION 'This message can''t be edited'; END IF;
  IF msg.sender_id IS NULL OR msg.sender_id <> me THEN
    RAISE EXCEPTION 'You can only edit your own messages';
  END IF;

  reason := public.meetup_chat_post_block_reason(msg.chat_id);
  IF reason = 'not_participant' THEN RAISE EXCEPTION 'This chat is not available';
  ELSIF reason IS NOT NULL THEN RAISE EXCEPTION 'This chat is read-only';
  END IF;

  UPDATE public.messages
     SET body = clean, edited_at = now()
   WHERE id = _message_id
  RETURNING id, chat_id, sender_id, body, type, created_at, edited_at, deleted_at
    INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id, 'chat_id', row_out.chat_id, 'sender_id', row_out.sender_id,
    'body', row_out.body, 'type', row_out.type, 'created_at', row_out.created_at,
    'edited_at', row_out.edited_at, 'deleted_at', row_out.deleted_at,
    'is_mine', true, 'is_suppressed', false, 'is_deleted', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_meetup_chat_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_meetup_chat_message(uuid, text) TO authenticated;

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
    RETURN jsonb_build_object(
      'id', msg.id, 'chat_id', msg.chat_id, 'sender_id', msg.sender_id,
      'body', NULL, 'type', msg.type, 'created_at', msg.created_at,
      'edited_at', NULL, 'deleted_at', msg.deleted_at,
      'is_mine', true, 'is_suppressed', false, 'is_deleted', true,
      'already_deleted', true
    );
  END IF;

  reason := public.meetup_chat_post_block_reason(msg.chat_id);
  IF reason = 'not_participant' THEN RAISE EXCEPTION 'This chat is not available'; END IF;

  INSERT INTO public.chat_message_deletions (source, message_id, sender_id, deleted_by, original_body)
  VALUES ('meetup_message', msg.id, msg.sender_id, me, msg.body)
  ON CONFLICT (source, message_id) DO NOTHING;

  UPDATE public.messages
     SET body = '', deleted_at = now(), edited_at = NULL
   WHERE id = _message_id
  RETURNING id, chat_id, sender_id, type, created_at, deleted_at
    INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id, 'chat_id', row_out.chat_id, 'sender_id', row_out.sender_id,
    'body', NULL, 'type', row_out.type, 'created_at', row_out.created_at,
    'edited_at', NULL, 'deleted_at', row_out.deleted_at,
    'is_mine', true, 'is_suppressed', false, 'is_deleted', true,
    'already_deleted', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_meetup_chat_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_meetup_chat_message(uuid) TO authenticated;

-- ------------------------------------------- readers: tombstones + edited ---
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
           (m.deleted_at IS NOT NULL) AS is_deleted
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

CREATE OR REPLACE FUNCTION public.get_my_dm_inbox()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
             'last_message_body', CASE WHEN lm.deleted_at IS NOT NULL THEN NULL ELSE lm.body END,
             'last_message_is_deleted', coalesce(lm.deleted_at IS NOT NULL, false),
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
      SELECT m.body, m.created_at, m.sender_id, m.deleted_at
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
         AND m.deleted_at IS NULL
    ) uc ON true
    WHERE me.id IS NOT NULL
      AND (c.user_a_id = me.id OR c.user_b_id = me.id)
      AND p.deleted_at IS NULL
      AND NOT public.is_blocked_between(me.id, p.id)
  ) s;
$function$;

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
