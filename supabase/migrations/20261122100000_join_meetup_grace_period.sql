-- 2026-11-22 — Late joins: allow joining a Meetup up to 30 minutes after it
-- starts (owner request: "before and during the first 30 minutes, not so
-- strict"). Only the time gate in join_meetup changes; every other rule
-- (eligibility, blocks, cancellation, capacity, removed members, invitation
-- reconciliation) is kept exactly as in 20260902123741.
--
-- Check-in already opens 60 minutes before start and stays open until
-- 4 hours after the end, so a member who joins during the grace window can
-- check in straight away.

CREATE OR REPLACE FUNCTION public.join_meetup(_meetup_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; existing_id uuid; new_id uuid; prior_status text; m RECORD; active_count int;
  grace CONSTANT interval := INTERVAL '30 minutes';
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.profile_is_eligible(me) THEN
    RAISE EXCEPTION 'This account can''t join Meetups.';
  END IF;

  SELECT id INTO existing_id FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
      AND status::text NOT IN ('cancelled','removed') LIMIT 1;
  IF existing_id IS NOT NULL THEN
    PERFORM public.reconcile_invitations_on_join(_meetup_id, me);
    RETURN existing_id;
  END IF;

  SELECT status::text INTO prior_status FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
    ORDER BY updated_at DESC LIMIT 1;
  IF prior_status = 'removed' THEN
    RAISE EXCEPTION 'You can''t rejoin this Meetup.';
  END IF;

  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;

  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  IF m.host_id <> me THEN
    IF NOT public.profile_is_eligible(m.host_id) THEN
      RAISE EXCEPTION 'This Meetup isn''t available to join.';
    END IF;
    IF public.is_blocked_between(me, m.host_id) THEN
      RAISE EXCEPTION 'This Meetup isn''t available to join.';
    END IF;
  END IF;

  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has been cancelled.';
  END IF;
  IF m.status = 'past'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already ended.';
  END IF;
  -- Grace window: joining stays open until 30 minutes after the start time
  -- (evaluated in the Meetup's own timezone, like before).
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) + grace < now() THEN
    RAISE EXCEPTION 'This Meetup started more than 30 minutes ago, so joining has closed.';
  END IF;

  IF m.host_id <> me THEN
    SELECT count(*) INTO active_count FROM public.attendance a
      WHERE a.meetup_id = _meetup_id AND a.status::text NOT IN ('cancelled','removed');
    IF active_count >= m.capacity THEN
      RAISE EXCEPTION 'This Meetup is full.';
    END IF;
  END IF;

  UPDATE public.attendance
     SET status = 'joined'::attendance_status, joined_at = now()
   WHERE profile_id = me AND meetup_id = _meetup_id AND status = 'cancelled'::attendance_status
   RETURNING id INTO new_id;
  IF new_id IS NULL THEN
    INSERT INTO public.attendance (profile_id, meetup_id, status)
      VALUES (me, _meetup_id, 'joined'::attendance_status)
      RETURNING id INTO new_id;
  END IF;

  -- WO-144A addendum: a member who joins directly (not through the invitation
  -- deep link) must not leave an open invitation behind, otherwise the host's
  -- invite sheet keeps showing "Already invited" instead of "Already attending".
  PERFORM public.reconcile_invitations_on_join(_meetup_id, me);
  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.join_meetup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_meetup(uuid) TO authenticated;
