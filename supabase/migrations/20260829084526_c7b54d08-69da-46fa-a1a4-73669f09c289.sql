REVOKE ALL ON public.dm_message_reactions FROM anon, authenticated;
REVOKE ALL ON public.meetup_message_reactions FROM anon, authenticated;
GRANT ALL ON public.dm_message_reactions TO service_role;
GRANT ALL ON public.meetup_message_reactions TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_dm_message_reaction(_message_id uuid, _emoji text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE me uuid; msg RECORD; conv RECORD; peer uuid; removed int; added boolean := false;
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
  peer := CASE WHEN me = conv.user_a_id THEN conv.user_b_id ELSE conv.user_a_id END;
  IF public.is_blocked_between(me, peer) THEN
    RAISE EXCEPTION 'Messaging is not available';
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
    'message_id', _message_id, 'emoji', _emoji, 'reacted', added,
    'reactions', public.dm_reaction_summary(_message_id, me)
  );
END; $fn$;

CREATE OR REPLACE FUNCTION public.toggle_meetup_message_reaction(_message_id uuid, _emoji text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE me uuid; msg RECORD; reason text; removed int; added boolean := false;
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

  reason := public.meetup_chat_post_block_reason(msg.chat_id);
  IF reason = 'not_participant' THEN RAISE EXCEPTION 'This chat is not available';
  ELSIF reason IS NOT NULL THEN RAISE EXCEPTION 'This chat is read-only';
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
    'message_id', _message_id, 'emoji', _emoji, 'reacted', added,
    'reactions', public.meetup_reaction_summary(_message_id, me)
  );
END; $fn$;

REVOKE ALL ON FUNCTION public.toggle_dm_message_reaction(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_meetup_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_dm_message_reaction(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_meetup_message_reaction(uuid, text) TO authenticated, service_role;