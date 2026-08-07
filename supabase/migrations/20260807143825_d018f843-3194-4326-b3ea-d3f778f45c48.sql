-- WO-066: Meetup attendance check-in integrity

-- 1. Remove forgeable direct write access to attendance
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance FROM authenticated;
REVOKE ALL ON public.attendance FROM anon, PUBLIC;
REVOKE ALL ON public.meetup_qr_tokens FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.attendance TO service_role;
GRANT ALL ON public.meetup_qr_tokens TO service_role;

DROP POLICY IF EXISTS "Users can create their own attendance" ON public.attendance;
DROP POLICY IF EXISTS "Users can update their own attendance" ON public.attendance;

-- 2. Canonical transition guard (defence in depth, independent of grants)
CREATE OR REPLACE FUNCTION public.guard_attendance_transitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  trusted boolean := COALESCE(current_setting('app.attendance_checkin', true), '') = '1';
  admin_path boolean := COALESCE(current_setting('app.attendance_admin', true), '') = '1';
  completed boolean;
  old_s text;
  new_s text;
BEGIN
  new_s := NEW.status::text;

  IF TG_OP = 'INSERT' THEN
    IF new_s <> 'joined' THEN
      RAISE EXCEPTION 'Attendance must start as joined';
    END IF;
    RETURN NEW;
  END IF;

  old_s := OLD.status::text;
  SELECT EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = OLD.meetup_id)
    INTO completed;

  IF completed AND old_s IS DISTINCT FROM new_s THEN
    RAISE EXCEPTION 'This Meetup is complete. Its attendance can no longer change.';
  END IF;

  IF old_s = new_s THEN RETURN NEW; END IF;

  IF new_s = 'attended' THEN
    RAISE EXCEPTION 'Attendance status not available';
  END IF;

  IF new_s = 'checked_in' THEN
    IF old_s <> 'joined' THEN
      RAISE EXCEPTION 'Only a joined attendee can check in';
    END IF;
    IF NOT trusted THEN
      RAISE EXCEPTION 'Check-in must go through the check-in action';
    END IF;
    RETURN NEW;
  END IF;

  -- leaving / removal / rejoin
  IF old_s IN ('checked_in','attended') THEN
    RAISE EXCEPTION 'A completed check-in can''t be undone.';
  END IF;

  IF new_s = 'removed' AND NOT admin_path THEN
    RAISE EXCEPTION 'Removal must go through the host removal action';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_guard_attendance_transitions ON public.attendance;
CREATE TRIGGER zzz_guard_attendance_transitions
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_transitions();

-- 3. Attendee self check-in (server authoritative, idempotent)
CREATE OR REPLACE FUNCTION public.check_in_to_meetup(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; att RECORD; win text; completed boolean;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _meetup_id IS NULL THEN RETURN jsonb_build_object('result','blocked','reason','invalid'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = _meetup_id)
    INTO completed;
  IF completed THEN
    RETURN jsonb_build_object('result','blocked','reason','completed');
  END IF;

  SELECT * INTO att FROM public.attendance a
    WHERE a.meetup_id = _meetup_id AND a.profile_id = me
    ORDER BY a.updated_at DESC LIMIT 1
    FOR UPDATE;

  IF att.id IS NULL OR att.status::text IN ('cancelled') THEN
    RETURN jsonb_build_object('result','blocked','reason','not_joined');
  END IF;
  IF att.status::text = 'removed' THEN
    RETURN jsonb_build_object('result','blocked','reason','removed');
  END IF;
  IF att.status::text IN ('checked_in','attended') THEN
    RETURN jsonb_build_object('result','already_checked_in','checked_in_at',att.checked_in_at);
  END IF;

  win := public.meetup_in_check_in_window(_meetup_id);
  IF win <> 'open' THEN
    RETURN jsonb_build_object('result','blocked','reason',
      CASE win WHEN 'missing' THEN 'invalid' ELSE win END);
  END IF;

  PERFORM set_config('app.attendance_checkin','1', true);
  UPDATE public.attendance
     SET status = 'checked_in'::attendance_status,
         checked_in_at = COALESCE(checked_in_at, now()),
         updated_at = now()
   WHERE id = att.id;
  PERFORM set_config('app.attendance_checkin','0', true);

  RETURN jsonb_build_object(
    'result','checked_in',
    'checked_in_at',(SELECT checked_in_at FROM public.attendance WHERE id = att.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_to_meetup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_to_meetup(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.guard_attendance_transitions() FROM PUBLIC, anon, authenticated;

-- 4. Relationship QR keeps its existing dual role, now via the trusted path
CREATE OR REPLACE FUNCTION public.verify_meetup_connection(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  me UUID; tok RECORD; win TEXT; both_attending BOOLEAN; connected BOOLEAN;
  a UUID; b UUID; existing UUID; peer_row RECORD; hash TEXT;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _token IS NULL OR length(_token) < 8 THEN
    RETURN jsonb_build_object('kind','invalid');
  END IF;

  hash := encode(extensions.digest(_token, 'sha256'), 'hex');

  SELECT t.* INTO tok FROM public.meetup_qr_tokens t WHERE t.token_hash = hash LIMIT 1;
  IF tok IS NULL THEN RETURN jsonb_build_object('kind','invalid'); END IF;
  IF tok.revoked_at IS NOT NULL OR tok.expires_at <= now() THEN
    RETURN jsonb_build_object('kind','expired');
  END IF;
  IF tok.issuer_profile_id = me THEN
    RETURN jsonb_build_object('kind','self');
  END IF;

  IF public.is_blocked_between(me, tok.issuer_profile_id) THEN
    RETURN jsonb_build_object('kind','blocked');
  END IF;

  win := public.meetup_in_check_in_window(tok.meetup_id);
  IF win = 'cancelled' THEN RETURN jsonb_build_object('kind','cancelled'); END IF;
  IF win = 'too_early' THEN RETURN jsonb_build_object('kind','too_early'); END IF;
  IF win = 'closed' THEN RETURN jsonb_build_object('kind','closed'); END IF;
  IF win <> 'open' THEN RETURN jsonb_build_object('kind','invalid'); END IF;

  SELECT
    EXISTS (SELECT 1 FROM public.attendance x WHERE x.profile_id = me AND x.meetup_id = tok.meetup_id AND x.status::text NOT IN ('cancelled','removed'))
    AND
    EXISTS (SELECT 1 FROM public.attendance x WHERE x.profile_id = tok.issuer_profile_id AND x.meetup_id = tok.meetup_id AND x.status::text NOT IN ('cancelled','removed'))
    INTO both_attending;
  IF NOT both_attending THEN RETURN jsonb_build_object('kind','not_attending'); END IF;

  connected := public.are_connected(me, tok.issuer_profile_id);
  IF NOT connected THEN
    RETURN jsonb_build_object('kind','not_connected',
      'peer', jsonb_build_object('id', tok.issuer_profile_id));
  END IF;

  a := LEAST(me, tok.issuer_profile_id);
  b := GREATEST(me, tok.issuer_profile_id);

  PERFORM set_config('app.attendance_checkin','1', true);
  UPDATE public.attendance
     SET status = 'checked_in'::attendance_status,
         checked_in_at = COALESCE(checked_in_at, now()),
         updated_at = now()
   WHERE meetup_id = tok.meetup_id
     AND profile_id IN (me, tok.issuer_profile_id)
     AND status = 'joined'::attendance_status;
  PERFORM set_config('app.attendance_checkin','0', true);

  SELECT id INTO existing FROM public.verified_meetup_connections
   WHERE profile_a_id = a AND profile_b_id = b LIMIT 1;
  IF existing IS NOT NULL THEN
    SELECT p.id, p.display_name, p.avatar_url INTO peer_row FROM public.profiles p WHERE p.id = tok.issuer_profile_id;
    RETURN jsonb_build_object('kind','already_verified',
      'peer', jsonb_build_object('id', peer_row.id, 'display_name', peer_row.display_name, 'avatar_url', peer_row.avatar_url));
  END IF;

  INSERT INTO public.verified_meetup_connections (profile_a_id, profile_b_id, meetup_id, scanned_by, token_issuer_id)
  VALUES (a, b, tok.meetup_id, me, tok.issuer_profile_id);

  INSERT INTO public.friendships (profile_a_id, profile_b_id, first_meetup_id, friends_since, status, requester_id)
  VALUES (a, b, tok.meetup_id, CURRENT_DATE, 'verified', me)
  ON CONFLICT (profile_a_id, profile_b_id) DO UPDATE
    SET status = 'verified',
        first_meetup_id = COALESCE(public.friendships.first_meetup_id, EXCLUDED.first_meetup_id),
        friends_since   = LEAST(public.friendships.friends_since, EXCLUDED.friends_since);

  SELECT p.id, p.display_name, p.avatar_url INTO peer_row FROM public.profiles p WHERE p.id = tok.issuer_profile_id;
  RETURN jsonb_build_object('kind','verified',
    'peer', jsonb_build_object('id', peer_row.id, 'display_name', peer_row.display_name, 'avatar_url', peer_row.avatar_url));
END;
$$;

-- 5. Host removal cannot erase a legitimate check-in
CREATE OR REPLACE FUNCTION public.remove_meetup_attendee(_meetup_id uuid, _attendee_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; m RECORD; att RECORD; clean text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean := NULLIF(btrim(COALESCE(_reason,'')), '');
  IF clean IS NOT NULL AND char_length(clean) > 300 THEN
    RAISE EXCEPTION 'Reason too long';
  END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF _attendee_id = m.host_id THEN RAISE EXCEPTION 'The host can''t be removed.'; END IF;

  SELECT * INTO att FROM public.attendance
    WHERE meetup_id = _meetup_id AND profile_id = _attendee_id
      AND status::text NOT IN ('cancelled','removed')
    ORDER BY updated_at DESC LIMIT 1;
  IF att IS NULL THEN
    RAISE EXCEPTION 'This attendee is no longer part of the Meetup.';
  END IF;
  IF att.status::text IN ('checked_in','attended') THEN
    RAISE EXCEPTION 'This Veggie has already checked in and can''t be removed.';
  END IF;

  PERFORM set_config('app.attendance_admin','1', true);
  UPDATE public.attendance SET
    status = 'removed'::attendance_status,
    removal_reason = clean,
    removed_at = now(),
    removed_by = me,
    updated_at = now()
  WHERE id = att.id;
  PERFORM set_config('app.attendance_admin','0', true);

  PERFORM public._insert_notification(
    _attendee_id, me, 'meetup_attendee_removed'::notification_type,
    'meetup', _meetup_id, 'meetup', _meetup_id,
    NULL,
    'You were removed from ' || COALESCE(m.title,'a Meetup') || '.',
    jsonb_build_object('meetup_id', _meetup_id, 'reason', clean),
    'attendance-removed:' || att.id::text
  );
END;
$$;

-- 6. Leaving cannot destroy a check-in
CREATE OR REPLACE FUNCTION public.leave_meetup(_meetup_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; is_host boolean; cur text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT (host_id = me) INTO is_host FROM public.meetups WHERE id = _meetup_id;
  IF is_host IS TRUE THEN
    RAISE EXCEPTION 'Hosts cannot leave their own Meetup';
  END IF;

  SELECT status::text INTO cur FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
    ORDER BY updated_at DESC LIMIT 1;

  IF cur IN ('checked_in','attended') THEN
    RAISE EXCEPTION 'You''ve already checked in to this Meetup.';
  END IF;

  UPDATE public.attendance
     SET status = 'cancelled'::attendance_status
   WHERE profile_id = me
     AND meetup_id = _meetup_id
     AND status = 'joined'::attendance_status;
END;
$$;
