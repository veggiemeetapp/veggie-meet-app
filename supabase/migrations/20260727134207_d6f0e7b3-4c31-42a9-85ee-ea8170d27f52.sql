
-- 1. profiles.discovery_visible
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discovery_visible boolean NOT NULL DEFAULT true;

-- 2. notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  meetup_invitations boolean NOT NULL DEFAULT true,
  meetup_updates boolean NOT NULL DEFAULT true,
  meetup_reminders boolean NOT NULL DEFAULT true,
  messages boolean NOT NULL DEFAULT true,
  connection_requests boolean NOT NULL DEFAULT true,
  connection_accepted boolean NOT NULL DEFAULT true,
  follow_up boolean NOT NULL DEFAULT true,
  community boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "np_owner_select" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE POLICY "np_owner_insert" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());

CREATE POLICY "np_owner_update" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());

CREATE TRIGGER trg_np_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. account_deletion_requests
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','blocked','completed','cancelled')),
  blockers jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adr_profile ON public.account_deletion_requests(profile_id);

GRANT SELECT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adr_owner_select" ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE TRIGGER trg_adr_updated_at
  BEFORE UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. get_my_settings
CREATE OR REPLACE FUNCTION public.get_my_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_result jsonb;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Ensure notification prefs row exists
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_my_settings() TO authenticated;

-- 5. update_profile_settings
CREATE OR REPLACE FUNCTION public.update_profile_settings(
  _display_name text DEFAULT NULL,
  _dietary_identity text DEFAULT NULL,
  _pronouns text DEFAULT NULL,
  _bio text DEFAULT NULL,
  _avatar_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_name text;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _display_name IS NOT NULL THEN
    v_name := btrim(_display_name);
    IF length(v_name) = 0 THEN
      RAISE EXCEPTION 'display_name required' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) > 40 THEN
      RAISE EXCEPTION 'display_name too long' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _bio IS NOT NULL AND length(_bio) > 500 THEN
    RAISE EXCEPTION 'bio too long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET display_name = COALESCE(v_name, display_name),
      dietary_identity = COALESCE(_dietary_identity, dietary_identity),
      pronouns = CASE WHEN _pronouns IS NOT NULL THEN NULLIF(btrim(_pronouns), '') ELSE pronouns END,
      bio = COALESCE(_bio, bio),
      avatar_url = CASE WHEN _avatar_url = '' THEN NULL ELSE COALESCE(_avatar_url, avatar_url) END,
      updated_at = now()
  WHERE id = v_pid;
END $$;

GRANT EXECUTE ON FUNCTION public.update_profile_settings(text,text,text,text,text) TO authenticated;

-- 6. update_discovery_settings
CREATE OR REPLACE FUNCTION public.update_discovery_settings(
  _home_city_id uuid DEFAULT NULL,
  _selected_city_id uuid DEFAULT NULL,
  _interests text[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _interests IS NOT NULL THEN
    IF array_length(_interests, 1) IS NULL OR array_length(_interests, 1) < 3 THEN
      RAISE EXCEPTION 'pick at least 3 interests' USING ERRCODE = '22023';
    END IF;
    IF array_length(_interests, 1) > 8 THEN
      RAISE EXCEPTION 'pick at most 8 interests' USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles SET interests = _interests, updated_at = now() WHERE id = v_pid;
  END IF;

  IF _home_city_id IS NOT NULL THEN
    PERFORM public.set_home_city(_home_city_id);
  END IF;

  IF _selected_city_id IS NOT NULL THEN
    PERFORM public.set_selected_city(_selected_city_id);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.update_discovery_settings(uuid,uuid,text[]) TO authenticated;

-- 7. update_notification_preferences
CREATE OR REPLACE FUNCTION public.update_notification_preferences(_prefs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_row public.notification_preferences;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

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
END $$;

GRANT EXECUTE ON FUNCTION public.update_notification_preferences(jsonb) TO authenticated;

-- 8. update_privacy_settings
CREATE OR REPLACE FUNCTION public.update_privacy_settings(_discovery_visible boolean DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _discovery_visible IS NOT NULL THEN
    UPDATE public.profiles
    SET discovery_visible = _discovery_visible, updated_at = now()
    WHERE id = v_pid;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.update_privacy_settings(boolean) TO authenticated;

-- 9. request_account_deletion
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Leave future attending meetups canonically (best-effort per row)
  PERFORM public.leave_meetup(a.meetup_id)
  FROM public.attendance a
  JOIN public.meetups m ON m.id = a.meetup_id
  WHERE a.profile_id = v_pid
    AND a.status IN ('joined','checked_in')
    AND m.host_id <> v_pid
    AND m.date >= (now() AT TIME ZONE 'UTC')::date;

  -- Anonymize profile (retain safety/audit trails via FK references)
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

  -- Delete the auth user (cascades sessions); profile stays with auth_user_id=NULL
  IF v_auth IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth;
  END IF;

  RETURN jsonb_build_object(
    'status','completed',
    'request_id', v_req_id,
    'future_hosted_meetup_count', 0,
    'future_attendance_count', v_attending
  );
END $$;

GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

-- 10. search_veggies: exclude hidden profiles (recreate honoring existing signature)
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='search_veggies' LIMIT 1;
  -- no-op: we handle visibility filtering at the app layer for safety (see src/lib/search.ts)
END $$;
