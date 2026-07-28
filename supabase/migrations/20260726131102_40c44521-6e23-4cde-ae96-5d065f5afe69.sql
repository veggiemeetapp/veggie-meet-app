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
  today date := (now() AT TIME ZONE 'utc')::date;
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
    WHERE p.id <> pid
      AND (_sel_city IS NULL OR p.home_city_id = _sel_city)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_profile_id = pid AND b.blocked_profile_id = p.id)
           OR (b.blocker_profile_id = p.id AND b.blocked_profile_id = pid)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE (f.profile_a_id = pid AND f.profile_b_id = p.id)
           OR (f.profile_a_id = p.id AND f.profile_b_id = pid)
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
           'join'::text AS action_type,
           me.date, me.start_time, me.capacity
    FROM public.meetups me
    LEFT JOIN public.cities mc ON mc.id = me.city_id
    WHERE me.status <> 'cancelled'
      AND me.date >= today
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
    ORDER BY me.date ASC, me.start_time ASC
    LIMIT 1
  ) m;

  BEGIN
    SELECT to_jsonb(pl) INTO place FROM (
      SELECT cp.id::text AS entity_id,
             'place'::text AS entity_type,
             cp.name AS title,
             cp.cover_image_url AS image,
             COALESCE(cpc.name, cp.city_name) AS city,
             'in_your_city'::text AS reason_code,
             'A veggie-friendly place in your city' AS reason_label,
             'view'::text AS action_type
      FROM public.community_places cp
      LEFT JOIN public.cities cpc ON cpc.id = cp.city_id
      WHERE (_sel_city IS NULL OR cp.city_id = _sel_city)
        AND COALESCE(cp.archived, false) = false
      ORDER BY cp.created_at DESC NULLS LAST
      LIMIT 1
    ) pl;
  EXCEPTION WHEN undefined_column THEN
    place := NULL;
  END;

  RETURN jsonb_build_object(
    'veggie', veggie,
    'meetup', meetup,
    'place',  place,
    'selected_city_id', _sel_city
  );
END;
$function$;