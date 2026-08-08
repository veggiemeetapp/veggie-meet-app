-- WO-070A DEF-070A-02: end-of-meetup checks compared a naive local timestamp to
-- now() (UTC), so completion (and therefore the 'completed' chat state) was
-- unreachable until the UTC clock caught up with local wall time.
CREATE OR REPLACE FUNCTION public.meetup_has_ended(_meetup_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetups m
    WHERE m.id = _meetup_id
      AND m.status <> 'cancelled'::meetup_status
      AND (
        (m.date::timestamp + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))
          AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC')
      ) <= now()
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_hosted_meetup(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid; m RECORD; ends_at timestamptz; others int; existing RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _meetup_id IS NULL THEN RAISE EXCEPTION 'Meetup required'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;

  SELECT * INTO existing FROM public.meetup_completions WHERE meetup_id = _meetup_id;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('result','already_completed','completed_at',existing.completed_at);
  END IF;

  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'Cancelled Meetups can''t be completed.';
  END IF;

  ends_at := (m.date::timestamp + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))
             AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC');
  IF ends_at > now() THEN
    RAISE EXCEPTION 'This Meetup hasn''t ended yet.';
  END IF;

  SELECT count(*) INTO others FROM public.attendance a
   WHERE a.meetup_id = _meetup_id
     AND a.profile_id <> me
     AND a.status::text IN ('checked_in','attended');
  IF others < 1 THEN
    RAISE EXCEPTION 'At least one other Veggie needs to have checked in before this Meetup can be completed.';
  END IF;

  UPDATE public.meetups
     SET status = 'past'::meetup_status, updated_at = now()
   WHERE id = _meetup_id;

  INSERT INTO public.meetup_completions (meetup_id, host_id, completion_method)
  VALUES (_meetup_id, me, 'host_confirmed')
  ON CONFLICT (meetup_id) DO NOTHING;

  RETURN jsonb_build_object(
    'result','completed',
    'completed_at',(SELECT completed_at FROM public.meetup_completions WHERE meetup_id = _meetup_id)
  );
END; $function$;

REVOKE ALL ON FUNCTION public.meetup_has_ended(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.meetup_has_ended(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_hosted_meetup(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_hosted_meetup(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_hosted_meetup(uuid) TO authenticated;