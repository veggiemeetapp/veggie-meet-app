
-- 1) Server-side blocked-profile availability RPC
CREATE OR REPLACE FUNCTION public.get_veggie_profile_availability(_target_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; exists_row boolean;
BEGIN
  me := public.current_profile_id();
  IF _target_profile_id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unavailable');
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = _target_profile_id) INTO exists_row;
  IF NOT exists_row THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unavailable');
  END IF;
  IF me IS NOT NULL AND me <> _target_profile_id
     AND public.is_blocked_between(me, _target_profile_id) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unavailable');
  END IF;
  RETURN jsonb_build_object('available', true);
END;
$$;

REVOKE ALL ON FUNCTION public.get_veggie_profile_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_veggie_profile_availability(uuid) TO authenticated;

-- 2) Message-evidence columns on user_reports (immutable snapshot for moderation)
ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS reported_message_id uuid,
  ADD COLUMN IF NOT EXISTS reported_message_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_message_snapshot text,
  ADD COLUMN IF NOT EXISTS reported_sender_profile_id uuid;

-- Do NOT expose evidence via the reporter-select policy already in place —
-- get_my_reports / get_my_report_detail intentionally omit these columns.

-- 3) Hardened per-message report RPC (server verifies evidence)
CREATE OR REPLACE FUNCTION public.submit_dm_message_report(
  _message_id uuid,
  _reason text,
  _details text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid;
  msg RECORD;
  conv RECORD;
  clean_reason text;
  clean_details text;
  row_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message required'; END IF;

  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL OR char_length(clean_reason) > 80 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')),'');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;

  SELECT id, conversation_id, sender_id, body, created_at
    INTO msg FROM public.dm_messages WHERE id = _message_id;
  IF msg IS NULL THEN RAISE EXCEPTION 'Message not found'; END IF;

  SELECT id, user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = msg.conversation_id;
  IF conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF me <> conv.user_a_id AND me <> conv.user_b_id THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF msg.sender_id = me THEN
    RAISE EXCEPTION 'Cannot report your own message';
  END IF;

  INSERT INTO public.user_reports (
    reporter_profile_id, reported_profile_id, conversation_id,
    reason, details,
    reported_message_id, reported_message_created_at,
    reported_message_snapshot, reported_sender_profile_id
  ) VALUES (
    me, msg.sender_id, msg.conversation_id,
    clean_reason, clean_details,
    msg.id, msg.created_at,
    left(msg.body, 2000), msg.sender_id
  ) RETURNING id INTO row_id;
  RETURN row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_dm_message_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_dm_message_report(uuid, text, text) TO authenticated;
