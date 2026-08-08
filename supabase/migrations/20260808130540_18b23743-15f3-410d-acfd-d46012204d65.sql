-- WO-074A: deleted profiles are inert everywhere member-facing.
CREATE OR REPLACE FUNCTION public.send_connection_request(_target_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; a uuid; b uuid; row_rec record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _target_profile_id IS NULL OR _target_profile_id = me THEN
    RETURN jsonb_build_object('state','invalid');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = _target_profile_id AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('state','invalid');
  END IF;
  IF public.is_blocked_between(me, _target_profile_id) THEN
    RETURN jsonb_build_object('state','unavailable');
  END IF;

  a := LEAST(me, _target_profile_id);
  b := GREATEST(me, _target_profile_id);

  SELECT * INTO row_rec FROM public.friendships
   WHERE profile_a_id = a AND profile_b_id = b FOR UPDATE;

  IF row_rec.id IS NOT NULL THEN
    IF row_rec.status IN ('connected','verified') THEN
      RETURN jsonb_build_object('state','already_connected','friendship_id',row_rec.id);
    ELSIF row_rec.status = 'pending' THEN
      IF row_rec.requester_id IS NOT NULL AND row_rec.requester_id <> me THEN
        UPDATE public.friendships SET status = 'connected' WHERE id = row_rec.id;
        RETURN jsonb_build_object('state','connected','friendship_id',row_rec.id);
      END IF;
      RETURN jsonb_build_object('state','already_pending','friendship_id',row_rec.id);
    ELSIF row_rec.status = 'blocked' THEN
      RETURN jsonb_build_object('state','unavailable');
    ELSE
      UPDATE public.friendships
         SET status = 'pending', requester_id = me
       WHERE id = row_rec.id;
      RETURN jsonb_build_object('state','requested','friendship_id',row_rec.id);
    END IF;
  END IF;

  INSERT INTO public.friendships (profile_a_id, profile_b_id, requester_id, status, friends_since)
  VALUES (a, b, me, 'pending', CURRENT_DATE)
  ON CONFLICT (profile_a_id, profile_b_id) DO NOTHING
  RETURNING id INTO row_rec.id;

  IF row_rec.id IS NULL THEN
    SELECT id INTO row_rec.id FROM public.friendships WHERE profile_a_id = a AND profile_b_id = b;
    RETURN jsonb_build_object('state','already_pending','friendship_id',row_rec.id);
  END IF;
  RETURN jsonb_build_object('state','requested','friendship_id',row_rec.id);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_or_create_dm(_other_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me UUID; a UUID; b UUID; conv_id UUID;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _other_profile_id IS NULL OR _other_profile_id = me THEN
    RAISE EXCEPTION 'Invalid recipient';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _other_profile_id AND deleted_at IS NULL
  ) THEN
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
      AND p.deleted_at IS NULL
      AND NOT public.is_blocked_between(me.id, p.id)
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.send_dm_message(_conversation_id uuid, _body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = peer AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This Veggie is no longer on VeggieMeet';
  END IF;
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
END; $function$;