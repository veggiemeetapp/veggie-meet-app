DO $$
DECLARE qa uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO qa
  FROM public.profiles
  WHERE display_name LIKE 'WO072_QA%'
     OR display_name IN ('<img src=x onerror=alert(1)>')
     OR auth_user_id IN (SELECT id FROM auth.users WHERE email LIKE 'wo072qa.%@lovable-smoke.test');

  IF array_length(qa,1) IS NULL THEN RETURN; END IF;

  SET session_replication_role = replica;

  DELETE FROM public.dm_messages m
   WHERE m.sender_id = ANY(qa)
      OR m.conversation_id IN (SELECT id FROM public.dm_conversations
                                WHERE user_a_id = ANY(qa) OR user_b_id = ANY(qa));
  DELETE FROM public.dm_conversations WHERE user_a_id = ANY(qa) OR user_b_id = ANY(qa);
  DELETE FROM public.notifications WHERE recipient_id = ANY(qa) OR actor_id = ANY(qa);
  DELETE FROM public.friendships WHERE profile_a_id = ANY(qa) OR profile_b_id = ANY(qa) OR requester_id = ANY(qa);
  DELETE FROM public.verified_meetup_connections
   WHERE profile_a_id = ANY(qa) OR profile_b_id = ANY(qa) OR scanned_by = ANY(qa) OR token_issuer_id = ANY(qa);
  DELETE FROM public.user_blocks WHERE blocker_profile_id = ANY(qa) OR blocked_profile_id = ANY(qa);
  DELETE FROM public.analytics_events WHERE profile_id = ANY(qa);
  DELETE FROM public.recommendation_feedback WHERE profile_id = ANY(qa);
  DELETE FROM public.community_place_visits WHERE profile_id = ANY(qa);
  DELETE FROM public.notification_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_onboarding_state WHERE profile_id = ANY(qa);
  DELETE FROM public.account_deletion_requests WHERE profile_id = ANY(qa);
  DELETE FROM public.profiles WHERE id = ANY(qa);

  SET session_replication_role = origin;
END $$;
