-- WO-076 DEF-076-01/02: cancellation requires a reason and is time-authoritative
CREATE OR REPLACE FUNCTION public.cancel_meetup(_meetup_id uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; m RECORD; clean text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  clean := NULLIF(btrim(COALESCE(_reason,'')), '');
  IF clean IS NULL THEN
    RAISE EXCEPTION 'Please add a short reason so attendees know why this Meetup was cancelled.';
  END IF;
  IF char_length(clean) > 300 THEN
    RAISE EXCEPTION 'Reason too long';
  END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already been cancelled.';
  END IF;
  -- Time authority: judge from the Meetup's own local timezone, never from the
  -- stored status column (nothing advances it on a schedule).
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) <= now() THEN
    RAISE EXCEPTION 'This Meetup has already started, so it can no longer be cancelled.';
  END IF;

  UPDATE public.meetups SET
    status = 'cancelled'::meetup_status,
    cancellation_reason = clean,
    cancelled_at = now(),
    updated_at = now()
  WHERE id = _meetup_id;

  UPDATE public.attendance
     SET status = 'cancelled'::attendance_status,
         updated_at = now()
   WHERE meetup_id = _meetup_id
     AND status IN ('joined'::attendance_status,
                    'checked_in'::attendance_status,
                    'attended'::attendance_status);
END;
$function$;

-- WO-076 DEF-076-03: lifecycle read model must be timezone-aware
CREATE OR REPLACE FUNCTION public.get_meetup_lifecycle(_meetup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; m RECORD; c RECORD; ends_at timestamptz; starts_at timestamptz;
        others int; is_host boolean; state text; blocked text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  is_host := (m.host_id = me);
  SELECT * INTO c FROM public.meetup_completions WHERE meetup_id = _meetup_id;

  starts_at := public.meetup_start_at(m.date, m.start_time, m.timezone);
  ends_at   := public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone);

  state := CASE
    WHEN m.status = 'cancelled'::meetup_status THEN 'cancelled'
    WHEN c.id IS NOT NULL THEN 'completed'
    WHEN ends_at <= now() THEN 'ended'
    WHEN starts_at <= now() THEN 'in_progress'
    ELSE 'upcoming' END;

  IF is_host AND c.id IS NULL THEN
    SELECT count(*) INTO others FROM public.attendance a
     WHERE a.meetup_id = _meetup_id AND a.profile_id <> me
       AND a.status::text IN ('checked_in','attended');
    blocked := CASE
      WHEN m.status = 'cancelled'::meetup_status THEN 'cancelled'
      WHEN ends_at > now() THEN 'not_ended'
      WHEN others < 1 THEN 'no_checked_in_attendees'
      ELSE NULL END;
  END IF;

  RETURN jsonb_build_object(
    'meetup_id', m.id,
    'lifecycle_state', state,
    'has_started', starts_at <= now(),
    'has_ended', ends_at <= now(),
    'is_completed', c.id IS NOT NULL,
    'completed_at', c.completed_at,
    'counts_toward_hosting_impact', (c.id IS NOT NULL AND m.status <> 'cancelled'::meetup_status),
    'is_host', is_host,
    'can_complete', COALESCE(is_host AND c.id IS NULL AND blocked IS NULL, false),
    'blocked_reason', blocked,
    'server_time', now()
  );
END; $function$;

-- WO-076 DEF-076-04: cancelled Meetups report `cancelled`, not `not_joined`
CREATE OR REPLACE FUNCTION public.check_in_to_meetup(_meetup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; att RECORD; win text; completed boolean; m RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _meetup_id IS NULL THEN RETURN jsonb_build_object('result','blocked','reason','invalid'); END IF;

  SELECT id, host_id, status INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m.id IS NULL THEN RETURN jsonb_build_object('result','blocked','reason','invalid'); END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RETURN jsonb_build_object('result','blocked','reason','cancelled');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = _meetup_id)
    INTO completed;
  IF completed THEN
    RETURN jsonb_build_object('result','blocked','reason','completed');
  END IF;

  IF m.host_id IS NOT NULL AND m.host_id <> me AND public.is_blocked_between(me, m.host_id) THEN
    RETURN jsonb_build_object('result','blocked','reason','unavailable');
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

  RETURN jsonb_build_object('result','checked_in','checked_in_at', now());
END; $function$;