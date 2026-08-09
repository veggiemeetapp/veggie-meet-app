-- WO-083 DEF-083-03: narrow message send idempotency.
ALTER TABLE public.dm_messages ADD COLUMN IF NOT EXISTS client_token uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_token uuid;

CREATE UNIQUE INDEX IF NOT EXISTS dm_messages_sender_client_token_uidx
  ON public.dm_messages (sender_id, client_token)
  WHERE client_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_token_uidx
  ON public.messages (sender_id, client_token)
  WHERE client_token IS NOT NULL;

DROP FUNCTION IF EXISTS public.send_dm_message(uuid, text);

CREATE OR REPLACE FUNCTION public.send_dm_message(
  _conversation_id uuid,
  _body text,
  _client_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE me UUID; conv RECORD; peer UUID; clean TEXT; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  clean := btrim(coalesce(_body, ''));
  IF clean = '' THEN RAISE EXCEPTION 'Message can''t be empty'; END IF;
  IF length(clean) > 2000 THEN RAISE EXCEPTION 'Messages must be under 2000 characters'; END IF;

  -- Idempotent replay: the same send retried after an ambiguous network result
  -- returns the original row instead of creating a duplicate message.
  IF _client_token IS NOT NULL THEN
    SELECT id, conversation_id, sender_id, body, created_at, read_at, invitation_id
      INTO row_out
      FROM public.dm_messages
     WHERE sender_id = me AND client_token = _client_token;
    IF row_out.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', row_out.id,
        'conversation_id', row_out.conversation_id,
        'sender_id', row_out.sender_id,
        'body', row_out.body,
        'created_at', row_out.created_at,
        'read_at', row_out.read_at,
        'invitation_id', row_out.invitation_id,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = _conversation_id FOR UPDATE;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  peer := CASE WHEN me = conv.user_a_id THEN conv.user_b_id ELSE conv.user_a_id END;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = peer AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This Veggie is no longer on VeggieMeet';
  END IF;
  IF public.is_blocked_between(me, peer) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;
  IF NOT public.are_connected(me, peer) THEN
    RAISE EXCEPTION 'You can only message connected Veggies';
  END IF;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body, client_token)
  VALUES (_conversation_id, me, clean, _client_token)
  RETURNING id, conversation_id, sender_id, body, created_at, read_at, invitation_id
  INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id,
    'conversation_id', row_out.conversation_id,
    'sender_id', row_out.sender_id,
    'body', row_out.body,
    'created_at', row_out.created_at,
    'read_at', row_out.read_at,
    'invitation_id', row_out.invitation_id,
    'idempotent_replay', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.send_dm_message(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_dm_message(uuid, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.send_meetup_chat_message(uuid, text);

CREATE OR REPLACE FUNCTION public.send_meetup_chat_message(
  _chat_id uuid,
  _body text,
  _client_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE me uuid; clean text; reason text; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean := btrim(COALESCE(_body, ''));
  IF clean = '' THEN RAISE EXCEPTION 'Message can''t be empty'; END IF;
  IF length(clean) > 2000 THEN RAISE EXCEPTION 'Messages must be under 2000 characters'; END IF;

  IF _client_token IS NOT NULL THEN
    SELECT id, chat_id, sender_id, body, type, created_at
      INTO row_out
      FROM public.messages
     WHERE sender_id = me AND client_token = _client_token;
    IF row_out.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', row_out.id,
        'chat_id', row_out.chat_id,
        'sender_id', row_out.sender_id,
        'body', row_out.body,
        'type', row_out.type,
        'created_at', row_out.created_at,
        'is_mine', true,
        'is_suppressed', false,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  reason := public.meetup_chat_post_block_reason(_chat_id);
  IF reason = 'not_participant' THEN RAISE EXCEPTION 'This chat is not available';
  ELSIF reason = 'cancelled' THEN RAISE EXCEPTION 'This Meetup was cancelled';
  ELSIF reason = 'completed' THEN RAISE EXCEPTION 'This Meetup is complete';
  ELSIF reason = 'archived' THEN RAISE EXCEPTION 'This chat is closed';
  END IF;

  INSERT INTO public.messages (chat_id, sender_id, body, type, client_token)
  VALUES (_chat_id, me, clean, 'user', _client_token)
  RETURNING id, chat_id, sender_id, body, type, created_at INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id,
    'chat_id', row_out.chat_id,
    'sender_id', row_out.sender_id,
    'body', row_out.body,
    'type', row_out.type,
    'created_at', row_out.created_at,
    'is_mine', true,
    'is_suppressed', false,
    'idempotent_replay', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.send_meetup_chat_message(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_meetup_chat_message(uuid, text, uuid) TO authenticated;