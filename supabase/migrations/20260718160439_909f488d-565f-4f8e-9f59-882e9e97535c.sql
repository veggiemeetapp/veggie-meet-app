
-- =========================================================
-- WO-025: create tables first, then functions/policies.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.dm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  CONSTRAINT dm_pair_ordered CHECK (user_a_id < user_b_id),
  CONSTRAINT dm_pair_unique UNIQUE (user_a_id, user_b_id)
);
CREATE INDEX IF NOT EXISTS dm_conversations_a_idx ON public.dm_conversations(user_a_id);
CREATE INDEX IF NOT EXISTS dm_conversations_b_idx ON public.dm_conversations(user_b_id);
CREATE INDEX IF NOT EXISTS dm_conversations_last_msg_idx ON public.dm_conversations(last_message_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.dm_conversations TO authenticated;
GRANT ALL ON public.dm_conversations TO service_role;
ALTER TABLE public.dm_conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.dm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  CONSTRAINT dm_body_nonempty CHECK (length(btrim(body)) > 0),
  CONSTRAINT dm_body_maxlen CHECK (length(body) <= 2000)
);
CREATE INDEX IF NOT EXISTS dm_messages_conv_time_idx ON public.dm_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS dm_messages_conv_unread_idx ON public.dm_messages(conversation_id) WHERE read_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.dm_messages TO authenticated;
GRANT ALL ON public.dm_messages TO service_role;
ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_no_self CHECK (blocker_profile_id <> blocked_profile_id),
  CONSTRAINT user_blocks_unique UNIQUE (blocker_profile_id, blocked_profile_id)
);
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.dm_conversations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_dm_participant(_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dm_conversations c
    WHERE c.id = _conversation_id
      AND (c.user_a_id = public.current_profile_id()
           OR c.user_b_id = public.current_profile_id())
  );
$$;

CREATE OR REPLACE FUNCTION public.are_connected(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.profile_a_id = LEAST(_a,_b)
      AND f.profile_b_id = GREATEST(_a,_b)
      AND f.status IN ('connected','verified')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_between(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_profile_id = _a AND ub.blocked_profile_id = _b)
       OR (ub.blocker_profile_id = _b AND ub.blocked_profile_id = _a)
  );
$$;

-- Policies --------------------------------------------------
CREATE POLICY "dm_conversations_participant_select"
ON public.dm_conversations FOR SELECT TO authenticated
USING (user_a_id = public.current_profile_id() OR user_b_id = public.current_profile_id());

CREATE POLICY "dm_conversations_participant_insert"
ON public.dm_conversations FOR INSERT TO authenticated
WITH CHECK (
  (user_a_id = public.current_profile_id() OR user_b_id = public.current_profile_id())
  AND user_a_id < user_b_id
);

CREATE POLICY "dm_messages_participant_select"
ON public.dm_messages FOR SELECT TO authenticated
USING (public.is_dm_participant(conversation_id));

CREATE POLICY "dm_messages_participant_insert"
ON public.dm_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = public.current_profile_id()
  AND public.is_dm_participant(conversation_id)
);

CREATE POLICY "dm_messages_recipient_read_update"
ON public.dm_messages FOR UPDATE TO authenticated
USING (
  public.is_dm_participant(conversation_id)
  AND sender_id <> public.current_profile_id()
)
WITH CHECK (
  public.is_dm_participant(conversation_id)
  AND sender_id <> public.current_profile_id()
);

CREATE POLICY "user_blocks_owner_select"
ON public.user_blocks FOR SELECT TO authenticated
USING (blocker_profile_id = public.current_profile_id());
CREATE POLICY "user_blocks_owner_insert"
ON public.user_blocks FOR INSERT TO authenticated
WITH CHECK (blocker_profile_id = public.current_profile_id());
CREATE POLICY "user_blocks_owner_delete"
ON public.user_blocks FOR DELETE TO authenticated
USING (blocker_profile_id = public.current_profile_id());

CREATE POLICY "user_reports_reporter_insert"
ON public.user_reports FOR INSERT TO authenticated
WITH CHECK (reporter_profile_id = public.current_profile_id());

-- Triggers --------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_dm_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE conv RECORD; other_id UUID;
BEGIN
  SELECT user_a_id, user_b_id INTO conv FROM public.dm_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF NEW.sender_id <> conv.user_a_id AND NEW.sender_id <> conv.user_b_id THEN
    RAISE EXCEPTION 'Sender is not a participant';
  END IF;
  other_id := CASE WHEN NEW.sender_id = conv.user_a_id THEN conv.user_b_id ELSE conv.user_a_id END;
  IF NOT public.are_connected(NEW.sender_id, other_id) THEN
    RAISE EXCEPTION 'You can only message connected Veggies';
  END IF;
  IF public.is_blocked_between(NEW.sender_id, other_id) THEN
    RAISE EXCEPTION 'Messaging is blocked between these users';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_enforce_dm_message ON public.dm_messages;
CREATE TRIGGER trg_enforce_dm_message
BEFORE INSERT ON public.dm_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_dm_message();

CREATE OR REPLACE FUNCTION public.bump_dm_conversation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.dm_conversations
     SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_bump_dm_conversation ON public.dm_messages;
CREATE TRIGGER trg_bump_dm_conversation
AFTER INSERT ON public.dm_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_dm_conversation();

-- RPCs ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_dm(_other_profile_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me UUID; a UUID; b UUID; conv_id UUID;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _other_profile_id IS NULL OR _other_profile_id = me THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF NOT public.are_connected(me, _other_profile_id) THEN
    RAISE EXCEPTION 'You must be connected to message this Veggie';
  END IF;
  IF public.is_blocked_between(me, _other_profile_id) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;
  a := LEAST(me, _other_profile_id);
  b := GREATEST(me, _other_profile_id);
  SELECT id INTO conv_id FROM public.dm_conversations WHERE user_a_id = a AND user_b_id = b;
  IF conv_id IS NULL THEN
    INSERT INTO public.dm_conversations (user_a_id, user_b_id) VALUES (a, b) RETURNING id INTO conv_id;
  END IF;
  RETURN conv_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_dm_read(_conversation_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me UUID; updated INT;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_dm_participant(_conversation_id) THEN RAISE EXCEPTION 'Not a participant'; END IF;
  UPDATE public.dm_messages
     SET read_at = now()
   WHERE conversation_id = _conversation_id
     AND sender_id <> me
     AND read_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;
GRANT EXECUTE ON FUNCTION public.mark_dm_read(UUID) TO authenticated;

-- Realtime --------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_messages;
ALTER TABLE public.dm_messages REPLICA IDENTITY FULL;
ALTER TABLE public.dm_conversations REPLICA IDENTITY FULL;
