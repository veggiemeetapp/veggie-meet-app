CREATE OR REPLACE FUNCTION public.request_account_deletion()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pid  uuid := public.current_profile_id();
  v_auth uuid;
  v_deleted_at timestamptz;
  v_hosted int := 0;
  v_attending int := 0;
  v_req_id uuid;
  v_meetup record;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT auth_user_id, deleted_at INTO v_auth, v_deleted_at
    FROM public.profiles WHERE id = v_pid FOR UPDATE;

  IF v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status','already_deleted',
      'request_id', (SELECT id FROM public.account_deletion_requests
                      WHERE profile_id = v_pid ORDER BY requested_at DESC LIMIT 1),
      'future_hosted_meetup_count', 0,
      'future_attendance_count', 0
    );
  END IF;

  INSERT INTO public.account_deletion_requests(profile_id, status)
  VALUES (v_pid, 'pending')
  RETURNING id INTO v_req_id;

  -- WO-074A / DEF-074-02:
  -- Attendance is classified by Meetup lifecycle + proof value, never forced
  -- through an invalid transition. Historical proof (checked_in / attended, or
  -- any row on a completed Meetup) is retained untouched and anonymized only
  -- through the profile row. The WO-066 guard stays fully in force.
  FOR v_meetup IN
    SELECT id FROM public.meetups
     WHERE host_id = v_pid
       AND status IN ('upcoming','full','in_progress')
       AND NOT EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = meetups.id)
  LOOP
    v_hosted := v_hosted + 1;

    UPDATE public.meetups
       SET status = 'cancelled',
           cancellation_reason = 'The host deleted their VeggieMeet account.',
           cancelled_at = now(),
           updated_at = now()
     WHERE id = v_meetup.id;

    INSERT INTO public.notifications
      (recipient_id, actor_id, type, entity_type, entity_id,
       destination_type, destination_id, title, body, metadata, dedup_key)
    SELECT a.profile_id, NULL, 'meetup_cancelled', 'meetup', v_meetup.id,
           'meetup', v_meetup.id,
           'Meetup cancelled',
           'This Meetup was cancelled because the host left VeggieMeet.',
           '{}'::jsonb,
           'meetup_cancelled:' || v_meetup.id || ':' || a.profile_id
      FROM public.attendance a
     WHERE a.meetup_id = v_meetup.id
       AND a.profile_id <> v_pid
       AND a.status IN ('joined','checked_in')
    ON CONFLICT (recipient_id, dedup_key) DO NOTHING;

    -- Only release guests who had merely joined. A guest already checked in
    -- keeps that record: it is historical proof, not future participation.
    UPDATE public.attendance
       SET status = 'cancelled', updated_at = now()
     WHERE meetup_id = v_meetup.id
       AND status = 'joined';
  END LOOP;

  SELECT count(*) INTO v_attending
    FROM public.attendance a
    JOIN public.meetups m ON m.id = a.meetup_id
   WHERE a.profile_id = v_pid
     AND a.status IN ('joined','checked_in')
     AND m.status IN ('upcoming','full','in_progress');

  -- Immediate loss of active access to every Meetup conversation.
  DELETE FROM public.chat_participants WHERE profile_id = v_pid;

  -- Neutralize only non-proof participation. checked_in / attended rows and
  -- anything on a completed Meetup are preserved.
  DELETE FROM public.attendance a
   WHERE a.profile_id = v_pid
     AND a.status NOT IN ('checked_in','attended')
     AND NOT EXISTS (
       SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = a.meetup_id
     );

  DELETE FROM public.meetup_invitations
   WHERE sender_id = v_pid OR recipient_id = v_pid;
  DELETE FROM public.meetup_qr_tokens WHERE issuer_profile_id = v_pid;
  DELETE FROM public.friendships
   WHERE profile_a_id = v_pid OR profile_b_id = v_pid;
  DELETE FROM public.user_blocks
   WHERE blocker_profile_id = v_pid OR blocked_profile_id = v_pid;

  DELETE FROM public.dm_messages dm
   WHERE dm.conversation_id IN (
     SELECT c.id FROM public.dm_conversations c
      WHERE (c.user_a_id = v_pid OR c.user_b_id = v_pid)
        AND NOT EXISTS (SELECT 1 FROM public.user_reports r WHERE r.conversation_id = c.id)
   )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_reports r WHERE r.reported_message_id = dm.id
     );

  DELETE FROM public.dm_conversations c
   WHERE (c.user_a_id = v_pid OR c.user_b_id = v_pid)
     AND NOT EXISTS (SELECT 1 FROM public.user_reports r WHERE r.conversation_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.dm_messages dm WHERE dm.conversation_id = c.id);

  DELETE FROM public.notifications
   WHERE recipient_id = v_pid OR actor_id = v_pid;
  DELETE FROM public.notification_preferences WHERE profile_id = v_pid;
  DELETE FROM public.profile_preferences WHERE profile_id = v_pid;
  DELETE FROM public.profile_onboarding_state WHERE profile_id = v_pid;
  DELETE FROM public.recommendation_feedback WHERE profile_id = v_pid;
  DELETE FROM public.meetup_update_seen WHERE profile_id = v_pid;
  DELETE FROM public.meetup_follow_up_state WHERE profile_id = v_pid;
  DELETE FROM public.meetup_feedback WHERE profile_id = v_pid;
  DELETE FROM public.community_place_visits WHERE profile_id = v_pid;
  DELETE FROM public.analytics_events WHERE profile_id = v_pid;

  UPDATE public.profiles
     SET display_name = 'Former Veggie',
         bio = '',
         avatar_url = NULL,
         pronouns = NULL,
         interests = '{}',
         dietary_identity = NULL,
         current_city = NULL,
         home_city_id = NULL,
         community_guidelines_accepted_at = NULL,
         is_active_host = false,
         discovery_visible = false,
         onboarding_completed = false,
         auth_user_id = NULL,
         deleted_at = now(),
         updated_at = now()
   WHERE id = v_pid;

  UPDATE public.account_deletion_requests
     SET status = 'completed', effective_at = now(), updated_at = now()
   WHERE id = v_req_id;

  IF v_auth IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth;
  END IF;

  RETURN jsonb_build_object(
    'status','completed',
    'request_id', v_req_id,
    'future_hosted_meetup_count', v_hosted,
    'future_attendance_count', v_attending
  );
END;
$function$;