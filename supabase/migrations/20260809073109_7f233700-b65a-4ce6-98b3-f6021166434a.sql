DO $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM public.profiles WHERE deleted_at IS NOT NULL AND display_name = 'Former Veggie';
  IF ids IS NULL THEN RETURN; END IF;
  DELETE FROM public.analytics_events WHERE profile_id = ANY(ids);
  DELETE FROM public.account_deletion_requests WHERE profile_id = ANY(ids);
  DELETE FROM public.notification_preferences WHERE profile_id = ANY(ids);
  DELETE FROM public.profile_preferences WHERE profile_id = ANY(ids);
  DELETE FROM public.profile_onboarding_state WHERE profile_id = ANY(ids);
  DELETE FROM public.profiles WHERE id = ANY(ids);
END $$;