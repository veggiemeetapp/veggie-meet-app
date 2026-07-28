
-- WO-029: Host Management primitives
-- 1) Enum additions
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'removed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'meetup_attendee_removed';

-- 2) New columns
ALTER TABLE public.meetups
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS removal_reason text,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES public.profiles(id);

-- 3) Refined attendance-enforcement trigger: 'removed' is inactive; capacity excludes removed+cancelled
CREATE OR REPLACE FUNCTION public.enforce_meetup_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m RECORD;
  active_count int;
  was_active boolean := false;
  will_be_active boolean;
  identity_changed boolean := false;
BEGIN
  will_be_active := NEW.status::text NOT IN ('cancelled','removed');

  IF TG_OP = 'UPDATE' THEN
    was_active := OLD.status::text NOT IN ('cancelled','removed');
    identity_changed := (OLD.profile_id <> NEW.profile_id) OR (OLD.meetup_id <> NEW.meetup_id);
    IF identity_changed THEN
      RAISE EXCEPTION 'Cannot change profile or meetup on attendance';
    END IF;
  END IF;

  IF NOT will_be_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND was_active THEN RETURN NEW; END IF;

  SELECT id, host_id, status, date, start_time, capacity
    INTO m FROM public.meetups WHERE id = NEW.meetup_id FOR UPDATE;

  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup is no longer accepting attendees';
  END IF;
  IF m.status IN ('past'::meetup_status,'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started';
  END IF;
  IF (m.date + m.start_time) < now() THEN
    RAISE EXCEPTION 'This Meetup has already started';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.profile_id = NEW.profile_id AND a.meetup_id = NEW.meetup_id
      AND a.status::text NOT IN ('cancelled','removed')
      AND (TG_OP = 'INSERT' OR a.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'You are already attending this Meetup';
  END IF;

  IF m.host_id = NEW.profile_id THEN RETURN NEW; END IF;

  SELECT count(*) INTO active_count FROM public.attendance a
    WHERE a.meetup_id = NEW.meetup_id
      AND a.status::text NOT IN ('cancelled','removed')
      AND (TG_OP = 'INSERT' OR a.id <> NEW.id);

  IF active_count >= m.capacity THEN
    RAISE EXCEPTION 'This Meetup is full';
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) join_meetup: reject rejoin if previously removed
CREATE OR REPLACE FUNCTION public.join_meetup(_meetup_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; existing_id uuid; new_id uuid; prior_status text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO existing_id FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
      AND status::text NOT IN ('cancelled','removed') LIMIT 1;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  SELECT status::text INTO prior_status FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
    ORDER BY updated_at DESC LIMIT 1;
  IF prior_status = 'removed' THEN
    RAISE EXCEPTION 'You can''t rejoin this Meetup.';
  END IF;

  UPDATE public.attendance
     SET status = 'joined'::attendance_status, joined_at = now()
   WHERE profile_id = me AND meetup_id = _meetup_id AND status = 'cancelled'::attendance_status
   RETURNING id INTO new_id;
  IF new_id IS NOT NULL THEN RETURN new_id; END IF;

  INSERT INTO public.attendance (profile_id, meetup_id, status)
    VALUES (me, _meetup_id, 'joined'::attendance_status)
    RETURNING id INTO new_id;
  RETURN new_id;
END;
$function$;

-- 5) enforce_meetup_invitation: exclude removed attendees
CREATE OR REPLACE FUNCTION public.enforce_meetup_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m RECORD; conv RECORD; attending_recipient boolean; attendee_count int; sender_attending boolean;
BEGIN
  SELECT id, host_id, status, date, start_time, capacity
    INTO m FROM public.meetups WHERE id = NEW.meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status <> 'upcoming' THEN
    RAISE EXCEPTION 'Meetup is no longer accepting invitations';
  END IF;
  IF (m.date + m.start_time) < now() THEN
    RAISE EXCEPTION 'Meetup has already started';
  END IF;

  IF m.host_id = NEW.sender_id THEN
    sender_attending := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.attendance
      WHERE profile_id = NEW.sender_id AND meetup_id = NEW.meetup_id
        AND status::text NOT IN ('cancelled','removed')
    ) INTO sender_attending;
  END IF;
  IF NOT sender_attending THEN
    RAISE EXCEPTION 'You must be hosting or attending this Meetup to invite';
  END IF;

  IF NOT public.are_connected(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'You can only invite connected Veggies';
  END IF;
  IF public.is_blocked_between(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = NEW.recipient_id AND meetup_id = NEW.meetup_id
      AND status::text NOT IN ('cancelled','removed')
  ) INTO attending_recipient;
  IF attending_recipient THEN
    RAISE EXCEPTION 'Recipient is already attending';
  END IF;

  SELECT count(*) INTO attendee_count FROM public.attendance
    WHERE meetup_id = NEW.meetup_id AND status::text NOT IN ('cancelled','removed');
  IF attendee_count >= m.capacity THEN
    RAISE EXCEPTION 'Meetup is full';
  END IF;

  SELECT user_a_id, user_b_id INTO conv FROM public.dm_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF NOT ((conv.user_a_id = NEW.sender_id AND conv.user_b_id = NEW.recipient_id)
       OR (conv.user_a_id = NEW.recipient_id AND conv.user_b_id = NEW.sender_id)) THEN
    RAISE EXCEPTION 'Conversation does not match sender/recipient';
  END IF;

  RETURN NEW;
END;
$function$;

-- 6) Host RPCs
CREATE OR REPLACE FUNCTION public.update_hosted_meetup(
  _meetup_id uuid,
  _title text,
  _description text,
  _date date,
  _start_time time,
  _end_time time,
  _capacity int,
  _community_place_id uuid,
  _custom_location_name text,
  _custom_location_address text,
  _cover_image_url text
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; m RECORD; active_count int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already been cancelled.';
  END IF;
  IF m.status IN ('past'::meetup_status,'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;

  IF _title IS NULL OR btrim(_title) = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF char_length(_title) > 120 THEN RAISE EXCEPTION 'Title too long'; END IF;
  IF _description IS NOT NULL AND char_length(_description) > 2000 THEN
    RAISE EXCEPTION 'Description too long';
  END IF;
  IF _capacity IS NULL OR _capacity < 1 THEN RAISE EXCEPTION 'Capacity must be a positive number'; END IF;
  IF (_date + _start_time) < now() THEN RAISE EXCEPTION 'Date and time must be in the future'; END IF;

  SELECT count(*) INTO active_count FROM public.attendance
    WHERE meetup_id = _meetup_id AND status::text NOT IN ('cancelled','removed');
  IF _capacity < active_count THEN
    RAISE EXCEPTION 'Capacity can''t be lower than the number of people already attending.';
  END IF;

  UPDATE public.meetups SET
    title = _title,
    description = COALESCE(_description, ''),
    date = _date,
    start_time = _start_time,
    end_time = _end_time,
    capacity = _capacity,
    community_place_id = _community_place_id,
    custom_location_name = _custom_location_name,
    custom_location_address = _custom_location_address,
    cover_image_url = COALESCE(_cover_image_url, cover_image_url),
    updated_at = now()
  WHERE id = _meetup_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_meetup(_meetup_id uuid, _reason text)
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
  IF clean IS NOT NULL AND char_length(clean) > 300 THEN
    RAISE EXCEPTION 'Reason too long';
  END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already been cancelled.';
  END IF;
  IF m.status IN ('past'::meetup_status,'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;

  UPDATE public.meetups SET
    status = 'cancelled'::meetup_status,
    cancellation_reason = clean,
    cancelled_at = now(),
    updated_at = now()
  WHERE id = _meetup_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_meetup_attendee(_meetup_id uuid, _attendee_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  UPDATE public.attendance SET
    status = 'removed'::attendance_status,
    removal_reason = clean,
    removed_at = now(),
    removed_by = me,
    updated_at = now()
  WHERE id = att.id;

  -- Notify removed attendee
  PERFORM public._insert_notification(
    _attendee_id, me, 'meetup_attendee_removed'::notification_type,
    'meetup', _meetup_id, 'meetup', _meetup_id,
    NULL,
    'You were removed from ' || COALESCE(m.title,'a Meetup') || '.',
    jsonb_build_object('meetup_id', _meetup_id, 'reason', clean),
    'attendance-removed:' || att.id::text
  );
END;
$function$;
