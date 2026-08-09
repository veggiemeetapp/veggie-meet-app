-- WO-084A cleanup: remove every temporary QA actor and all telemetry they
-- produced. Founder data and published Community Places are untouched.
DO $$
DECLARE
  qa uuid[];
BEGIN
  SELECT array_agg(id) INTO qa
  FROM public.profiles
  WHERE display_name IN ('QAAlpha','QABravo','QACharlie');

  IF qa IS NULL THEN RETURN; END IF;

  DELETE FROM public.analytics_events WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_onboarding_state WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.notification_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.notifications WHERE recipient_id = ANY(qa) OR actor_id = ANY(qa);
  DELETE FROM public.profiles WHERE id = ANY(qa);
END $$;

-- Any stray probe telemetry written outside the QA profiles.
DELETE FROM public.analytics_events
WHERE properties::text LIKE '%probe_%'
   OR properties::text LIKE '%rate_%';