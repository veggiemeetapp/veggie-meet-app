CREATE OR REPLACE FUNCTION public.get_beta_activation_summary(_window text DEFAULT '7d')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- WO-097. Product timezone for calendar-day windows is Asia/Ho_Chi_Minh
  -- (the beta market). '7d'/'30d' are rolling intervals from now().
  v_tz text := 'Asia/Ho_Chi_Minh';
  v_win text := lower(coalesce(_window, '7d'));
  v_from timestamptz;
  v_result jsonb;
  v_steps text[] := ARRAY['welcome','auth','identity','dietary','home_city',
                          'selected_city','interests','photo','guidelines','safety'];
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_win NOT IN ('today','7d','30d') THEN v_win := '7d'; END IF;

  v_from := CASE v_win
    WHEN 'today' THEN date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz
    WHEN '7d' THEN now() - interval '7 days'
    ELSE now() - interval '30 days'
  END;

  WITH ev AS (
    SELECT profile_id, event_name, properties
      FROM public.analytics_events
     WHERE created_at >= v_from
       AND event_name IN (
         'auth_signup_started','auth_signup_success','auth_signin_success',
         'onboarding_step_viewed','onboarding_step_completed','onboarding_completed',
         'today_opened','community_home_opened','community_places_opened',
         'community_place_detail_opened','host_opened','meet_next_opened',
         'network_opened','my_plans_opened','notifications_opened','you_opened',
         'settings_opened','beta_feedback_opened',
         'meetup_created','meetup_created_at_community_place','meetup_joined',
         'connection_request_sent','connection_request_accepted',
         'community_place_check_in_started','community_place_check_in_succeeded',
         'community_place_check_in_failed','community_place_suggestion_submitted'
       )
  ),
  per_event AS (
    SELECT event_name,
           count(DISTINCT profile_id)::int AS members,
           count(*)::int AS events
      FROM ev GROUP BY event_name
  ),
  steps AS (
    SELECT properties->>'step' AS step,
           count(DISTINCT profile_id)::int AS members,
           count(*)::int AS events
      FROM ev
     WHERE event_name = 'onboarding_step_viewed'
       AND properties->>'step' = ANY (v_steps)
     GROUP BY 1
  ),
  action_members AS (
    SELECT DISTINCT profile_id FROM ev
     WHERE event_name IN ('meetup_created','meetup_joined',
        'connection_request_sent','connection_request_accepted',
        'community_place_check_in_succeeded','community_place_suggestion_submitted')
  ),
  today_and_community AS (
    SELECT profile_id FROM ev WHERE event_name = 'today_opened'
    INTERSECT
    SELECT profile_id FROM ev
     WHERE event_name IN ('community_home_opened','community_places_opened')
  ),
  explored AS (
    SELECT DISTINCT profile_id FROM ev
     WHERE event_name IN ('community_home_opened','community_places_opened')
  ),
  meet_intent AS (
    SELECT DISTINCT profile_id FROM ev
     WHERE event_name IN ('meet_next_opened','network_opened')
  )
  SELECT jsonb_build_object(
    'window', v_win,
    'window_start', v_from,
    'generated_at', now(),
    'product_timezone', v_tz,
    'total_events', (SELECT coalesce(sum(events),0)::int FROM per_event),
    'events', (
      SELECT coalesce(jsonb_object_agg(event_name,
                jsonb_build_object('members', members, 'events', events)), '{}'::jsonb)
        FROM per_event
    ),
    'stages', jsonb_build_object(
      'joined', (SELECT coalesce(members,0) FROM per_event WHERE event_name='onboarding_completed'),
      'reached_today', (SELECT coalesce(members,0) FROM per_event WHERE event_name='today_opened'),
      'explored_community', (SELECT count(*)::int FROM explored),
      'viewed_place', (SELECT coalesce(members,0) FROM per_event WHERE event_name='community_place_detail_opened'),
      'opened_host', (SELECT coalesce(members,0) FROM per_event WHERE event_name='host_opened'),
      'opened_meet', (SELECT count(*)::int FROM meet_intent),
      'community_action', (SELECT count(*)::int FROM action_members)
    ),
    'today_and_community_members', (SELECT count(*)::int FROM today_and_community),
    'onboarding_steps', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'step', s.step, 'members', coalesce(st.members,0), 'events', coalesce(st.events,0))
               ORDER BY s.ord), '[]'::jsonb)
        FROM unnest(v_steps) WITH ORDINALITY AS s(step, ord)
        LEFT JOIN steps st ON st.step = s.step
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_beta_activation_summary(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_beta_activation_summary(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_beta_activation_summary(text) TO authenticated;