DELETE FROM public.profile_onboarding_state
WHERE profile_id IN (
  SELECT p.id FROM public.profiles p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE u.email LIKE 'wo080qa.%@lovable-smoke.test'
);

DELETE FROM public.profile_preferences
WHERE profile_id IN (
  SELECT p.id FROM public.profiles p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE u.email LIKE 'wo080qa.%@lovable-smoke.test'
);

DELETE FROM public.notification_preferences
WHERE profile_id IN (
  SELECT p.id FROM public.profiles p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE u.email LIKE 'wo080qa.%@lovable-smoke.test'
);

DELETE FROM public.analytics_events
WHERE profile_id IN (
  SELECT p.id FROM public.profiles p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE u.email LIKE 'wo080qa.%@lovable-smoke.test'
);

DELETE FROM public.profiles
WHERE auth_user_id IN (
  SELECT id FROM auth.users WHERE email LIKE 'wo080qa.%@lovable-smoke.test'
);