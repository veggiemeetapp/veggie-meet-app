CREATE OR REPLACE FUNCTION public.get_my_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_result jsonb;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_preferences(profile_id)
  VALUES (v_pid)
  ON CONFLICT (profile_id) DO NOTHING;

  SELECT jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'dietary_identity', p.dietary_identity,
      'pronouns', p.pronouns,
      'interests', p.interests
    ),
    'discovery', jsonb_build_object(
      'home_city_id', p.home_city_id,
      'selected_city_id', pp.selected_city_id,
      'interests', p.interests
    ),
    'notifications', to_jsonb(np.*) - 'profile_id' - 'created_at' - 'updated_at',
    'privacy', jsonb_build_object(
      'discovery_visible', p.discovery_visible,
      'location_permission_result', pp.location_permission_result,
      'notification_permission_result', pp.notification_permission_result
    ),
    -- WO-081: the account block intentionally carries the member's own email
    -- only. The internal auth user id is never returned to the client.
    'account', jsonb_build_object(
      'email', (SELECT email FROM auth.users WHERE id = p.auth_user_id),
      'community_guidelines_accepted_at', p.community_guidelines_accepted_at
    ),
    'generated_at', now()
  )
  INTO v_result
  FROM public.profiles p
  LEFT JOIN public.profile_preferences pp ON pp.profile_id = p.id
  LEFT JOIN public.notification_preferences np ON np.profile_id = p.id
  WHERE p.id = v_pid;

  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.update_notification_preferences(_prefs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_row public.notification_preferences;
  v_allowed text[] := ARRAY[
    'meetup_invitations','meetup_updates','meetup_reminders','messages',
    'connection_requests','connection_accepted','follow_up','community'
  ];
  v_key text;
  v_val jsonb;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _prefs IS NULL OR jsonb_typeof(_prefs) <> 'object' THEN
    RAISE EXCEPTION 'invalid preferences payload' USING ERRCODE = '22023';
  END IF;

  -- WO-081: explicit allowlist. Unknown / deprecated keys and non-boolean
  -- values are rejected instead of silently ignored, so no arbitrary JSON
  -- preference injection is possible.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(_prefs) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'unknown notification preference: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_val) <> 'boolean' THEN
      RAISE EXCEPTION 'notification preference % must be true or false', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO public.notification_preferences(profile_id) VALUES (v_pid)
  ON CONFLICT (profile_id) DO NOTHING;

  UPDATE public.notification_preferences SET
    meetup_invitations  = COALESCE((_prefs->>'meetup_invitations')::boolean,  meetup_invitations),
    meetup_updates      = COALESCE((_prefs->>'meetup_updates')::boolean,      meetup_updates),
    meetup_reminders    = COALESCE((_prefs->>'meetup_reminders')::boolean,    meetup_reminders),
    messages            = COALESCE((_prefs->>'messages')::boolean,            messages),
    connection_requests = COALESCE((_prefs->>'connection_requests')::boolean, connection_requests),
    connection_accepted = COALESCE((_prefs->>'connection_accepted')::boolean, connection_accepted),
    follow_up           = COALESCE((_prefs->>'follow_up')::boolean,           follow_up),
    community           = COALESCE((_prefs->>'community')::boolean,           community),
    updated_at = now()
  WHERE profile_id = v_pid
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row) - 'profile_id' - 'created_at' - 'updated_at';
END $function$;

REVOKE ALL ON FUNCTION public.get_my_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_notification_preferences(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_notification_preferences(jsonb) TO authenticated;