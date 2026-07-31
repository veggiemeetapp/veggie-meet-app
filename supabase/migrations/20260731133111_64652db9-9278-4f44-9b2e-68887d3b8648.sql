CREATE OR REPLACE FUNCTION public.request_account_deletion()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- NOTE: avatar objects are removed by the client through the Storage API
  -- BEFORE this RPC is called. Direct DELETE against storage.objects is
  -- rejected by the platform and would abort the whole deletion.
  IF v_auth IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth;
  END IF;

  RETURN jsonb_build_object(
    'status','completed',
    'request_id', v_req_id,
    'future_attendance_count', v_attending
  );
END;
$function$;