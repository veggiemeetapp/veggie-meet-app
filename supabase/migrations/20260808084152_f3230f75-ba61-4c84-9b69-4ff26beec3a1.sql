-- WO-070 Meetup group chat privacy & membership integrity

-- 1) Eligibility helpers -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.meetup_chat_meetup_id(_chat_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT meetup_id FROM public.chats WHERE id = _chat_id;
$$;

CREATE OR REPLACE FUNCTION public.can_read_meetup_chat(_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chats c
    JOIN public.meetups m ON m.id = c.meetup_id
    WHERE c.id = _chat_id
      AND public.current_profile_id() IS NOT NULL
      AND (
        m.host_id = public.current_profile_id()
        OR EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.meetup_id = m.id
            AND a.profile_id = public.current_profile_id()
            AND a.status NOT IN ('cancelled', 'removed')
        )
      )
  );
$$;

-- Posting window: not cancelled, not completed, and within 24h after end.
CREATE OR REPLACE FUNCTION public.meetup_chat_post_block_reason(_chat_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE m RECORD; ends_at timestamptz;
BEGIN
  IF NOT public.can_read_meetup_chat(_chat_id) THEN RETURN 'not_participant'; END IF;
  SELECT mm.* INTO m
    FROM public.chats c JOIN public.meetups mm ON mm.id = c.meetup_id
   WHERE c.id = _chat_id;
  IF m.id IS NULL THEN RETURN 'not_participant'; END IF;
  IF m.status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF EXISTS (SELECT 1 FROM public.meetup_completions mc WHERE mc.meetup_id = m.id) THEN
    RETURN 'completed';
  END IF;
  ends_at := ((m.date::text || ' ' || m.end_time::text)::timestamp)
             AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC');
  IF m.end_time <= m.start_time THEN ends_at := ends_at + interval '1 day'; END IF;
  IF now() > ends_at + interval '24 hours' THEN RETURN 'archived'; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_post_meetup_chat(_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.meetup_chat_post_block_reason(_chat_id) IS NULL;
$$;

REVOKE ALL ON FUNCTION public.meetup_chat_meetup_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_meetup_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_post_meetup_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meetup_chat_post_block_reason(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_meetup_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_post_meetup_chat(uuid) TO authenticated;

-- 2) Lock down direct DML ----------------------------------------------------

DROP POLICY IF EXISTS "Users can join chats as themselves" ON public.chat_participants;
DROP POLICY IF EXISTS "Participants can send user messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can read chat rosters" ON public.chat_participants;
DROP POLICY IF EXISTS "Participants can read their chats" ON public.chats;
DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;

CREATE POLICY "Meetup participants can read chat rosters"
ON public.chat_participants FOR SELECT TO authenticated
USING (public.can_read_meetup_chat(chat_id));

CREATE POLICY "Meetup participants can read their chats"
ON public.chats FOR SELECT TO authenticated
USING (public.can_read_meetup_chat(id));

CREATE POLICY "Meetup participants can read messages"
ON public.messages FOR SELECT TO authenticated
USING (public.can_read_meetup_chat(chat_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.chat_participants FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.messages FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.chats FROM authenticated;
GRANT SELECT ON public.chat_participants TO authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT SELECT ON public.chats TO authenticated;
GRANT ALL ON public.chat_participants TO service_role;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.chats TO service_role;

-- 3) Roster follows attendance ----------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_chat_roster_from_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE target_chat_id uuid;
BEGIN
  SELECT id INTO target_chat_id FROM public.chats WHERE meetup_id = NEW.meetup_id;
  IF target_chat_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('cancelled', 'removed') THEN
    DELETE FROM public.chat_participants
     WHERE chat_id = target_chat_id AND profile_id = NEW.profile_id;
  ELSE
    INSERT INTO public.chat_participants (chat_id, profile_id)
    VALUES (target_chat_id, NEW.profile_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chat_roster ON public.attendance;
CREATE TRIGGER trg_sync_chat_roster
AFTER UPDATE OF status ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.sync_chat_roster_from_attendance();

-- 4) Server-authoritative chat RPCs -----------------------------------------

CREATE OR REPLACE FUNCTION public.get_meetup_chat_context(_chat_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; m RECORD; reason text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_read_meetup_chat(_chat_id) THEN
    RETURN jsonb_build_object('can_read', false);
  END IF;
  SELECT mm.* INTO m FROM public.chats c JOIN public.meetups mm ON mm.id = c.meetup_id
   WHERE c.id = _chat_id;
  reason := public.meetup_chat_post_block_reason(_chat_id);
  RETURN jsonb_build_object(
    'can_read', true,
    'can_post', reason IS NULL,
    'post_block_reason', reason,
    'chat_id', _chat_id,
    'is_host', m.host_id = me,
    'participant_count', (
      SELECT count(*) FROM public.attendance a
       WHERE a.meetup_id = m.id AND a.status NOT IN ('cancelled', 'removed')
    ),
    'meetup', jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'date', m.date,
      'start_time', m.start_time,
      'end_time', m.end_time,
      'status', m.status,
      'location_name', COALESCE(m.location_name, m.custom_location_name),
      'address', COALESCE(m.address, m.custom_location_address),
      'timezone', m.timezone
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_meetup_chat_thread(
  _chat_id uuid,
  _before_created_at timestamptz DEFAULT NULL,
  _before_id uuid DEFAULT NULL,
  _limit integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    SELECT msg.id, msg.chat_id, msg.sender_id, msg.body, msg.type, msg.created_at
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
               'is_mine', p.sender_id = me,
               'is_suppressed', p.sender_id IS NOT NULL AND p.sender_id = ANY(suppressed),
               'body', CASE
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
$$;

CREATE OR REPLACE FUNCTION public.send_meetup_chat_message(_chat_id uuid, _body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; clean text; reason text; row_out RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean := btrim(COALESCE(_body, ''));
  IF clean = '' THEN RAISE EXCEPTION 'Message can''t be empty'; END IF;
  IF length(clean) > 2000 THEN RAISE EXCEPTION 'Messages must be under 2000 characters'; END IF;

  reason := public.meetup_chat_post_block_reason(_chat_id);
  IF reason = 'not_participant' THEN RAISE EXCEPTION 'This chat is not available';
  ELSIF reason = 'cancelled' THEN RAISE EXCEPTION 'This Meetup was cancelled';
  ELSIF reason = 'completed' THEN RAISE EXCEPTION 'This Meetup is complete';
  ELSIF reason = 'archived' THEN RAISE EXCEPTION 'This chat is closed';
  END IF;

  INSERT INTO public.messages (chat_id, sender_id, body, type)
  VALUES (_chat_id, me, clean, 'user')
  RETURNING id, chat_id, sender_id, body, type, created_at INTO row_out;

  RETURN jsonb_build_object(
    'id', row_out.id,
    'chat_id', row_out.chat_id,
    'sender_id', row_out.sender_id,
    'body', row_out.body,
    'type', row_out.type,
    'created_at', row_out.created_at,
    'is_mine', true,
    'is_suppressed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meetup_chat_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meetup_chat_thread(uuid, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_meetup_chat_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_chat_roster_from_attendance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meetup_chat_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_meetup_chat_thread(uuid, timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_meetup_chat_message(uuid, text) TO authenticated;