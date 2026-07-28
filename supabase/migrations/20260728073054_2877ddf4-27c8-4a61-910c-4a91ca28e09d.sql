
-- 1) Secure helper: current user's own profile row
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- 2) Hide auth_user_id from authenticated table reads (WHERE + SELECT).
-- Owner access continues via get_my_profile() and current_profile_id().
REVOKE SELECT (auth_user_id) ON public.profiles FROM authenticated;
-- anon has no profiles grant already (Batch 2). Belt-and-suspenders:
REVOKE SELECT (auth_user_id) ON public.profiles FROM anon;

-- 3) Cancel-meetup: transition active attendance to cancelled + backfill.
CREATE OR REPLACE FUNCTION public.cancel_meetup(_meetup_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Transition every active attendance row to cancelled so My Plans, capacity,
  -- and follow-up surfaces reflect reality. Host row included.
  UPDATE public.attendance
     SET status = 'cancelled'::attendance_status,
         updated_at = now()
   WHERE meetup_id = _meetup_id
     AND status IN ('joined'::attendance_status,
                    'checked_in'::attendance_status,
                    'attended'::attendance_status);
END;
$$;

-- Back-fill: 29 attendance rows currently active on already-cancelled meetups.
UPDATE public.attendance a
   SET status = 'cancelled'::attendance_status,
       updated_at = now()
  FROM public.meetups m
 WHERE m.id = a.meetup_id
   AND m.status = 'cancelled'::meetup_status
   AND a.status IN ('joined'::attendance_status,
                    'checked_in'::attendance_status,
                    'attended'::attendance_status);

-- 4) Account deletion: also purge avatar objects for that auth user so
--    previously-shared signed URLs stop resolving to the image.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_auth uuid;
  v_hosted int;
  v_attending int;
  v_req_id uuid;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT auth_user_id INTO v_auth FROM public.profiles WHERE id = v_pid;

  SELECT count(*) INTO v_hosted
  FROM public.meetups
  WHERE host_id = v_pid
    AND status IN ('upcoming','full','in_progress')
    AND date >= (now() AT TIME ZONE 'UTC')::date;

  SELECT count(*) INTO v_attending
  FROM public.attendance a
  JOIN public.meetups m ON m.id = a.meetup_id
  WHERE a.profile_id = v_pid
    AND a.status IN ('joined','checked_in')
    AND m.status IN ('upcoming','full','in_progress')
    AND m.date >= (now() AT TIME ZONE 'UTC')::date;

  IF v_hosted > 0 THEN
    INSERT INTO public.account_deletion_requests(profile_id, status, blockers)
    VALUES (v_pid, 'blocked', jsonb_build_object('future_hosted_meetup_count', v_hosted))
    RETURNING id INTO v_req_id;

    RETURN jsonb_build_object(
      'status','blocked',
      'request_id', v_req_id,
      'future_hosted_meetup_count', v_hosted,
      'future_attendance_count', v_attending,
      'blockers', jsonb_build_object('future_hosted_meetup_count', v_hosted)
    );
  END IF;

  PERFORM public.leave_meetup(a.meetup_id)
  FROM public.attendance a
  JOIN public.meetups m ON m.id = a.meetup_id
  WHERE a.profile_id = v_pid
    AND a.status IN ('joined','checked_in')
    AND m.host_id <> v_pid
    AND m.date >= (now() AT TIME ZONE 'UTC')::date;

  UPDATE public.profiles
  SET display_name = 'Former Veggie',
      bio = '',
      avatar_url = NULL,
      interests = '{}',
      pronouns = NULL,
      dietary_identity = NULL,
      discovery_visible = false,
      onboarding_completed = false,
      auth_user_id = NULL,
      updated_at = now()
  WHERE id = v_pid;

  INSERT INTO public.account_deletion_requests(profile_id, status, effective_at)
  VALUES (v_pid, 'completed', now())
  RETURNING id INTO v_req_id;

  INSERT INTO public.analytics_events(profile_id, event_name, properties)
  VALUES (
    v_pid,
    'account_deletion_completed',
    jsonb_build_object(
      'future_attendance_count', v_attending,
      'source', 'rpc'
    )
  );

  -- Purge storage avatar objects owned by this auth user. SECURITY DEFINER
  -- bypasses storage RLS. Failures raise; the whole txn rolls back safely.
  IF v_auth IS NOT NULL THEN
    DELETE FROM storage.objects
     WHERE bucket_id = 'avatars'
       AND (owner = v_auth OR (storage.foldername(name))[1] = v_auth::text);

    DELETE FROM auth.users WHERE id = v_auth;
  END IF;

  RETURN jsonb_build_object(
    'status','completed',
    'request_id', v_req_id,
    'future_attendance_count', v_attending
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
