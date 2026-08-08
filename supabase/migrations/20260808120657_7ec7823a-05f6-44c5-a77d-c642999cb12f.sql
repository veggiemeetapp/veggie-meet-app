DO $$
DECLARE qa uuid[];
BEGIN
  SELECT array_agg(p.id) INTO qa
  FROM public.profiles p JOIN auth.users u ON u.id = p.auth_user_id
  WHERE u.email LIKE 'wo073qa%@lovable-smoke.test';

  IF qa IS NULL THEN RETURN; END IF;

  SET LOCAL session_replication_role = replica;

  DELETE FROM public.analytics_events WHERE profile_id = ANY(qa);
  DELETE FROM public.notification_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_onboarding_state WHERE profile_id = ANY(qa);
  DELETE FROM public.notifications WHERE recipient_id = ANY(qa) OR actor_id = ANY(qa);
  DELETE FROM public.profiles WHERE id = ANY(qa);
END $$;