CREATE TABLE public.dm_conversation_clears (
  conversation_id UUID NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cleared_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, profile_id)
);

GRANT SELECT ON public.dm_conversation_clears TO authenticated;
GRANT ALL ON public.dm_conversation_clears TO service_role;

ALTER TABLE public.dm_conversation_clears ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own conversation clears"
  ON public.dm_conversation_clears
  FOR SELECT
  TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE INDEX idx_dm_conversation_clears_profile
  ON public.dm_conversation_clears (profile_id, conversation_id);

CREATE TRIGGER update_dm_conversation_clears_updated_at
  BEFORE UPDATE ON public.dm_conversation_clears
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Boundary helper: when did this member last clear this conversation?
CREATE OR REPLACE FUNCTION public.dm_cleared_at(_conversation_id UUID, _profile_id UUID)
RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cleared_at FROM public.dm_conversation_clears
   WHERE conversation_id = _conversation_id AND profile_id = _profile_id
$$;

REVOKE ALL ON FUNCTION public.dm_cleared_at(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dm_cleared_at(UUID, UUID) TO service_role;

-- Server-authoritative per-participant delete ("Delete chat" / delete for me).
CREATE OR REPLACE FUNCTION public.delete_dm_conversation_for_me(_conversation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me UUID; conv RECORD; ts TIMESTAMP WITH TIME ZONE;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = _conversation_id;
  IF conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  INSERT INTO public.dm_conversation_clears (conversation_id, profile_id, cleared_at)
  VALUES (_conversation_id, me, now())
  ON CONFLICT (conversation_id, profile_id)
  DO UPDATE SET cleared_at = now(), updated_at = now()
  RETURNING cleared_at INTO ts;

  RETURN jsonb_build_object('conversation_id', _conversation_id, 'cleared_at', ts);
END; $$;

REVOKE ALL ON FUNCTION public.delete_dm_conversation_for_me(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_dm_conversation_for_me(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_dm_conversation_for_me(UUID) TO service_role;

-- Inbox: hide cleared conversations until a newer message arrives; previews and
-- unread counts are computed only from post-clear messages.
CREATE OR REPLACE FUNCTION public.get_my_dm_inbox()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
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
             'last_message_at', lm.created_at,
             'last_sender_id', lm.sender_id,
             'unread_count', coalesce(uc.n, 0)
           ) AS x
    FROM public.dm_conversations c
    JOIN me ON true
    JOIN public.profiles p
      ON p.id = CASE WHEN c.user_a_id = me.id THEN c.user_b_id ELSE c.user_a_id END
    LEFT JOIN public.friendships f
      ON f.profile_a_id = LEAST(me.id, p.id) AND f.profile_b_id = GREATEST(me.id, p.id)
    LEFT JOIN public.dm_conversation_clears cl
      ON cl.conversation_id = c.id AND cl.profile_id = me.id
    LEFT JOIN LATERAL (
      SELECT m.body, m.created_at, m.sender_id, m.deleted_at
        FROM public.dm_messages m
       WHERE m.conversation_id = c.id
         AND (cl.cleared_at IS NULL OR m.created_at > cl.cleared_at)
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM public.dm_messages m
       WHERE m.conversation_id = c.id
         AND m.sender_id <> me.id
         AND m.read_at IS NULL
         AND m.deleted_at IS NULL
         AND (cl.cleared_at IS NULL OR m.created_at > cl.cleared_at)
    ) uc ON true
    WHERE me.id IS NOT NULL
      AND (c.user_a_id = me.id OR c.user_b_id = me.id)
      AND p.deleted_at IS NULL
      AND NOT public.is_blocked_between(me.id, p.id)
      AND (cl.cleared_at IS NULL OR lm.created_at IS NOT NULL)
  ) s;
$function$;

-- Thread: only messages after this member's own clear boundary.
CREATE OR REPLACE FUNCTION public.get_dm_thread(_conversation_id uuid, _before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me UUID; conv RECORD; peer_row RECORD; lim INT; msgs jsonb; has_more BOOLEAN; cleared TIMESTAMPTZ;
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

  SELECT cl.cleared_at INTO cleared
    FROM public.dm_conversation_clears cl
   WHERE cl.conversation_id = _conversation_id AND cl.profile_id = me;

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
       AND (cleared IS NULL OR m.created_at > cleared)
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