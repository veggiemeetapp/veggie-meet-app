
-- =========================================================
-- WO-027: Canonical attendance validation + capacity trigger
-- =========================================================

-- Trigger: enforce all attendance rules at the DB layer.
-- Fires BEFORE INSERT OR UPDATE. Only re-validates when the resulting row
-- is "active" (status <> 'cancelled') AND (on UPDATE) the row is newly
-- active or its meetup/profile changed.
CREATE OR REPLACE FUNCTION public.enforce_meetup_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  active_count int;
  was_active boolean := false;
  will_be_active boolean;
  identity_changed boolean := false;
BEGIN
  will_be_active := NEW.status <> 'cancelled'::attendance_status;

  IF TG_OP = 'UPDATE' THEN
    was_active := OLD.status <> 'cancelled'::attendance_status;
    identity_changed := (OLD.profile_id <> NEW.profile_id)
                     OR (OLD.meetup_id  <> NEW.meetup_id);
    IF identity_changed THEN
      RAISE EXCEPTION 'Cannot change profile or meetup on attendance';
    END IF;
  END IF;

  -- Nothing to validate if the row is (still) cancelled.
  IF NOT will_be_active THEN
    RETURN NEW;
  END IF;

  -- Skip re-validation if the row was already active and stays active
  -- (e.g., updating checked_in_at). Full validation only runs on new active rows.
  IF TG_OP = 'UPDATE' AND was_active THEN
    RETURN NEW;
  END IF;

  -- Lock the Meetup row so concurrent joins serialize on capacity.
  SELECT id, host_id, status, date, start_time, capacity
    INTO m
    FROM public.meetups
   WHERE id = NEW.meetup_id
   FOR UPDATE;

  IF m IS NULL THEN
    RAISE EXCEPTION 'Meetup not found';
  END IF;

  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup is no longer accepting attendees';
  END IF;

  IF m.status IN ('past'::meetup_status, 'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started';
  END IF;

  IF (m.date + m.start_time) < now() THEN
    RAISE EXCEPTION 'This Meetup has already started';
  END IF;

  -- Duplicate active attendance (skip the row being updated).
  IF EXISTS (
    SELECT 1 FROM public.attendance a
     WHERE a.profile_id = NEW.profile_id
       AND a.meetup_id  = NEW.meetup_id
       AND a.status <> 'cancelled'::attendance_status
       AND (TG_OP = 'INSERT' OR a.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'You are already attending this Meetup';
  END IF;

  -- Host bypasses capacity (host row is auto-created and always fits).
  IF m.host_id = NEW.profile_id THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO active_count
    FROM public.attendance a
   WHERE a.meetup_id = NEW.meetup_id
     AND a.status <> 'cancelled'::attendance_status
     AND (TG_OP = 'INSERT' OR a.id <> NEW.id);

  IF active_count >= m.capacity THEN
    RAISE EXCEPTION 'This Meetup is full';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_attendance_iu ON public.attendance;
CREATE TRIGGER enforce_attendance_iu
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.enforce_meetup_attendance();

-- ---------------------------------------------------------
-- Canonical join_meetup RPC — authenticated, idempotent
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_meetup(_meetup_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid;
  existing_id uuid;
  new_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent: already-active attendance returns success silently.
  SELECT id INTO existing_id
    FROM public.attendance
   WHERE profile_id = me
     AND meetup_id = _meetup_id
     AND status <> 'cancelled'::attendance_status
   LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  -- If a cancelled row exists, reactivate it (trigger re-validates).
  UPDATE public.attendance
     SET status = 'joined'::attendance_status,
         joined_at = now()
   WHERE profile_id = me
     AND meetup_id = _meetup_id
     AND status = 'cancelled'::attendance_status
   RETURNING id INTO new_id;

  IF new_id IS NOT NULL THEN
    RETURN new_id;
  END IF;

  INSERT INTO public.attendance (profile_id, meetup_id, status)
    VALUES (me, _meetup_id, 'joined'::attendance_status)
    RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_meetup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.join_meetup(uuid) TO authenticated;

-- ---------------------------------------------------------
-- Canonical leave_meetup RPC
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_meetup(_meetup_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid;
  is_host boolean;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT (host_id = me) INTO is_host FROM public.meetups WHERE id = _meetup_id;
  IF is_host IS TRUE THEN
    RAISE EXCEPTION 'Hosts cannot leave their own Meetup';
  END IF;

  UPDATE public.attendance
     SET status = 'cancelled'::attendance_status
   WHERE profile_id = me
     AND meetup_id = _meetup_id
     AND status <> 'cancelled'::attendance_status;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_meetup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.leave_meetup(uuid) TO authenticated;

-- ---------------------------------------------------------
-- Route invitation joins through the canonical operation
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_from_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid; inv RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO inv FROM public.meetup_invitations WHERE id = _invitation_id;
  IF inv IS NULL OR inv.recipient_id <> me THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  -- Delegate to canonical join. Capacity/status/time checks and
  -- idempotency all live there + in the attendance trigger.
  PERFORM public.join_meetup(inv.meetup_id);

  UPDATE public.meetup_invitations
     SET status = 'joined',
         joined_at = COALESCE(joined_at, now()),
         viewed_at = COALESCE(viewed_at, now())
   WHERE id = _invitation_id;
END;
$$;

-- ---------------------------------------------------------
-- Note on host auto-attendance: handle_new_meetup() inserts the host
-- attendance row via SECURITY DEFINER; the trigger's host bypass allows it.
-- ---------------------------------------------------------
