CREATE OR REPLACE FUNCTION public._valid_report_reason(_kind text, _code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _kind
    WHEN 'profile' THEN _code = ANY (ARRAY[
      'harassment','discrimination','threatening_behavior','inappropriate_content',
      'impersonation','spam_or_scam','safety_concern','other'])
    WHEN 'message' THEN _code = ANY (ARRAY[
      'harassment','threatening_message','sexual_content','hate_or_discrimination',
      'spam_or_scam','personal_information','other'])
    WHEN 'meetup' THEN _code = ANY (ARRAY[
      'misleading_information','unsafe_environment','inappropriate_host_behavior',
      'harassment','discrimination','cancelled_without_notice','other'])
    WHEN 'safety' THEN _code = ANY (ARRAY[
      'safety_concern','harassment','discrimination','unsafe_environment','other'])
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public._valid_report_reason(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._valid_report_reason(text, text) FROM anon;
REVOKE ALL ON FUNCTION public._valid_report_reason(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._valid_report_reason(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_profile_report(_reported_profile_id uuid, _reason text, _details text, _conversation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; row_id uuid; clean_reason text; clean_details text; recent int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _reported_profile_id IS NULL OR _reported_profile_id = me THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _reported_profile_id) THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;

  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF NOT (public._valid_report_reason('profile', clean_reason)
          OR public._valid_report_reason('message', clean_reason)) THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')),'');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;

  SELECT id INTO row_id FROM public.user_reports
   WHERE reporter_profile_id = me
     AND reported_profile_id = _reported_profile_id
     AND created_at > now() - interval '24 hours'
   ORDER BY created_at DESC LIMIT 1;
  IF row_id IS NOT NULL THEN RETURN row_id; END IF;

  SELECT count(*) INTO recent FROM public.user_reports
   WHERE reporter_profile_id = me AND created_at > now() - interval '24 hours';
  IF recent >= 10 THEN
    RAISE EXCEPTION 'You''ve submitted a lot of reports today. Please try again later.';
  END IF;

  INSERT INTO public.user_reports (reporter_profile_id, reported_profile_id, conversation_id, reason, details)
    VALUES (me, _reported_profile_id, _conversation_id, clean_reason, clean_details)
    RETURNING id INTO row_id;
  RETURN row_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.submit_dm_message_report(_message_id uuid, _reason text, _details text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; msg RECORD; conv RECORD; clean_reason text; clean_details text; row_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message required'; END IF;

  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF NOT public._valid_report_reason('message', clean_reason) THEN
    RAISE EXCEPTION 'Invalid reason';
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
$function$;

CREATE OR REPLACE FUNCTION public.report_meetup(_meetup_id uuid, _reason text, _details text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; m RECORD; clean_reason text; clean_details text; row_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean_reason := NULLIF(btrim(COALESCE(_reason,'')), '');
  IF clean_reason IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF NOT public._valid_report_reason('meetup', clean_reason) THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')), '');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;
  SELECT id, host_id INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  INSERT INTO public.meetup_reports (meetup_id, reporter_profile_id, host_profile_id, reason, details)
  VALUES (_meetup_id, me, m.host_id, clean_reason, clean_details)
  RETURNING id INTO row_id;
  RETURN row_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_safety_report(_reason text, _details text, _context_meetup_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me UUID; row_id UUID; clean_reason text; clean_details text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF NOT public._valid_report_reason('safety', clean_reason) THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')),'');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;
  INSERT INTO public.safety_reports (reporter_profile_id, reason, details, context_meetup_id)
    VALUES (me, clean_reason, clean_details, _context_meetup_id)
    RETURNING id INTO row_id;
  RETURN row_id;
END; $function$;