-- 1. Step vocabulary + monotonicity guard on save_onboarding_step
CREATE OR REPLACE FUNCTION public.save_onboarding_step(_step text, _completed boolean DEFAULT true, _skipped boolean DEFAULT false, _next_step text DEFAULT NULL::text)
 RETURNS profile_onboarding_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
  row public.profile_onboarding_state;
  valid_steps text[] := ARRAY['welcome','auth','identity','dietary','home_city','selected_city','interests','photo','guidelines','safety','starting_point'];
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  IF _step IS NULL OR NOT (_step = ANY(valid_steps)) THEN
    RAISE EXCEPTION 'unsupported onboarding step: %', COALESCE(_step,'(null)') USING errcode='22023';
  END IF;
  IF _next_step IS NOT NULL AND NOT (_next_step = ANY(valid_steps)) THEN
    RAISE EXCEPTION 'unsupported onboarding step: %', _next_step USING errcode='22023';
  END IF;

  INSERT INTO public.profile_onboarding_state (profile_id, current_step)
  VALUES (pid, COALESCE(_next_step, _step))
  ON CONFLICT (profile_id) DO NOTHING;

  UPDATE public.profile_onboarding_state
  SET
    completed_steps = CASE WHEN _completed AND NOT (_step = ANY(completed_steps))
                           THEN array_append(completed_steps, _step)
                           ELSE completed_steps END,
    skipped_steps   = CASE WHEN _skipped AND NOT (_step = ANY(skipped_steps))
                           THEN array_append(skipped_steps, _step)
                           ELSE skipped_steps END,
    -- Never regress a finished onboarding back into the flow, and never let a
    -- client jump straight to 'done' (only complete_onboarding may set that).
    current_step    = CASE WHEN completed_at IS NOT NULL THEN 'done'
                           ELSE COALESCE(_next_step, current_step) END
  WHERE profile_id = pid
  RETURNING * INTO row;

  RETURN row;
END;
$function$;

-- 2/3. Starting options: discovery-eligible people only; real place columns.
CREATE OR REPLACE FUNCTION public.get_onboarding_starting_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
  sel_city uuid;
  home_city uuid;
  _sel_city uuid;
  veggie jsonb;
  meetup jsonb;
  place jsonb;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  SELECT selected_city_id INTO sel_city FROM public.profile_preferences WHERE profile_id = pid;
  SELECT home_city_id INTO home_city FROM public.profiles WHERE id = pid;
  _sel_city := COALESCE(sel_city, home_city);

  SELECT to_jsonb(v) INTO veggie FROM (
    SELECT p.id AS entity_id,
           'veggie'::text AS entity_type,
           p.display_name AS title,
           p.avatar_url  AS image,
           COALESCE(c.name, p.current_city) AS city,
           'shared_city'::text AS reason_code,
           'In your city' AS reason_label,
           'connect'::text AS action_type
    FROM public.profiles p
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE p.id IN (SELECT public.discovery_eligible_profile_ids(pid, false))
      AND (_sel_city IS NULL OR p.home_city_id = _sel_city)
      AND NOT EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.profile_a_id = LEAST(pid, p.id)
          AND f.profile_b_id = GREATEST(pid, p.id)
      )
    ORDER BY (p.interests && (SELECT interests FROM public.profiles WHERE id = pid)) DESC NULLS LAST,
             p.updated_at DESC
    LIMIT 1
  ) v;

  SELECT to_jsonb(m) INTO meetup FROM (
    SELECT me.id AS entity_id,
           'meetup'::text AS entity_type,
           me.title AS title,
           me.cover_image_url AS image,
           COALESCE(mc.name, me.city_name_snapshot) AS city,
           'upcoming_in_city'::text AS reason_code,
           'Happening soon in your city' AS reason_label,
           'join'::text AS action_type
    FROM public.meetups me
    LEFT JOIN public.cities mc ON mc.id = me.city_id
    WHERE me.status <> 'cancelled'
      AND public.meetup_start_at(me.date, me.start_time, me.timezone) > now()
      AND me.location_source <> 'unknown'
      AND me.city_id IS NOT NULL
      AND (_sel_city IS NULL OR me.city_id = _sel_city)
      AND me.host_id <> pid
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_profile_id = pid AND b.blocked_profile_id = me.host_id)
           OR (b.blocker_profile_id = me.host_id AND b.blocked_profile_id = pid)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.meetup_id = me.id AND a.profile_id = pid
          AND a.status <> 'cancelled'
      )
      AND (
        SELECT count(*) FROM public.attendance a2
        WHERE a2.meetup_id = me.id AND a2.status NOT IN ('cancelled')
      ) < me.capacity
    ORDER BY public.meetup_start_at(me.date, me.start_time, me.timezone) ASC
    LIMIT 1
  ) m;

  SELECT to_jsonb(pl) INTO place FROM (
    SELECT cp.id::text AS entity_id,
           'place'::text AS entity_type,
           cp.name AS title,
           cp.cover_image_url AS image,
           COALESCE(cpc.name, cp.neighborhood) AS city,
           'in_your_city'::text AS reason_code,
           'A veggie-friendly place in your city' AS reason_label,
           'view'::text AS action_type
    FROM public.community_places cp
    LEFT JOIN public.cities cpc ON cpc.id = cp.city_id
    WHERE (_sel_city IS NULL OR cp.city_id = _sel_city)
      AND cp.is_active IS TRUE
      AND cp.verification_status = 'verified'
      AND COALESCE(cp.maintenance_status, 'operational') = 'operational'
    ORDER BY cp.upcoming_meetups_count DESC NULLS LAST, cp.created_at DESC NULLS LAST
    LIMIT 1
  ) pl;

  RETURN jsonb_build_object(
    'veggie', veggie,
    'meetup', meetup,
    'place',  place,
    'selected_city_id', _sel_city
  );
END;
$function$;

-- 4. No email-derived public display name for brand new accounts.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (auth_user_id, display_name)
  VALUES (
    NEW.id,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name',
                          NEW.raw_user_meta_data->>'full_name',
                          NEW.raw_user_meta_data->>'name', '')), '')
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END; $function$;
