CREATE OR REPLACE FUNCTION public.get_my_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
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
    'account', jsonb_build_object(
      'email', (SELECT email FROM auth.users WHERE id = p.auth_user_id),
      'auth_user_id', p.auth_user_id,
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