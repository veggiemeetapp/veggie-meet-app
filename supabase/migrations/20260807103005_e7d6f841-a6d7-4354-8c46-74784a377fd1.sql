CREATE OR REPLACE FUNCTION public.get_community_place_detail(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  p record;
  my_visits int := 0;
  my_last timestamptz;
  supporters int := 0;
  supported_total int := 0;
  counts_toward boolean := false;
  upcoming_count int := 0;
  hosted_count int := 0;
  meetups_json jsonb := '[]'::jsonb;
  freshness text;
  can_check_in boolean := false;
  can_host boolean := false;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, category::text AS category, address, neighborhood,
         cover_image_url, image_rights_status, description, veggie_reason,
         website_url, google_maps_url, veggie_classification,
         COALESCE(maintenance_status, 'operational') AS maintenance_status,
         is_active, verification_status, business_status,
         last_reverified_at, verified_at
    INTO p
    FROM public.community_places
   WHERE id = _place_id;

  -- Not published, hidden, permanently closed or vegan status unconfirmed:
  -- no public detail at all, and no hint that a private record exists.
  IF NOT FOUND
     OR p.is_active IS NOT TRUE
     OR p.verification_status <> 'verified'
     OR COALESCE(p.veggie_classification, '') <> 'fully_vegan'
     OR p.maintenance_status = 'permanently_closed' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT count(*)::int, max(visited_at)
    INTO my_visits, my_last
    FROM public.community_place_visits v
   WHERE v.profile_id = me
     AND v.community_place_id = _place_id
     AND v.verification_status = 'verified';

  SELECT count(DISTINCT v.profile_id)::int
    INTO supporters
    FROM public.community_place_visits v
   WHERE v.community_place_id = _place_id
     AND v.verification_status = 'verified';

  SELECT count(*)::int INTO supported_total FROM public._legit_place_supports(me);
  counts_toward := EXISTS (
    SELECT 1 FROM public._legit_place_supports(me) s
     WHERE s.community_place_id = _place_id
  );

  SELECT count(*)::int INTO upcoming_count
    FROM public.meetups m
   WHERE m.community_place_id = _place_id
     AND m.status <> 'cancelled'::meetup_status
     AND m.date >= (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date;

  SELECT count(*)::int INTO hosted_count
    FROM public.meetups m
   WHERE m.community_place_id = _place_id
     AND m.status = 'past'::meetup_status;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'date', x->>'start_time', x->>'id'), '[]'::jsonb)
    INTO meetups_json
    FROM (
      SELECT jsonb_build_object(
               'id', m.id,
               'title', m.title,
               'category', m.category::text,
               'date', m.date,
               'start_time', m.start_time,
               'end_time', m.end_time,
               'status', m.status::text,
               'capacity', m.capacity,
               'attendee_count', (
                 SELECT count(*)::int FROM public.attendance a
                  WHERE a.meetup_id = m.id
                    AND a.status::text IN ('joined','checked_in','attended')
               ),
               'host_display_name', h.display_name,
               'host_avatar_url', h.avatar_url
             ) AS x
        FROM public.meetups m
        LEFT JOIN public.profiles h ON h.id = m.host_id
       WHERE m.community_place_id = _place_id
         AND m.status <> 'cancelled'::meetup_status
         AND m.date >= (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
       ORDER BY m.date, m.start_time, m.id
       LIMIT 4
    ) q;

  freshness := CASE
    WHEN p.maintenance_status = 'needs_reverification' THEN 'refresh_pending'
    WHEN COALESCE(p.last_reverified_at, p.verified_at) IS NULL THEN 'due_soon'
    WHEN COALESCE(p.last_reverified_at, p.verified_at) > now() - INTERVAL '180 days' THEN 'recent'
    WHEN COALESCE(p.last_reverified_at, p.verified_at) > now() - INTERVAL '365 days' THEN 'due_soon'
    ELSE 'refresh_pending'
  END;

  can_check_in := p.maintenance_status = 'operational'
                  AND (p.business_status IS NULL OR p.business_status = 'OPERATIONAL');
  can_host := can_check_in;

  RETURN jsonb_build_object(
    'found', true,
    'place', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'category', p.category,
      'neighborhood', p.neighborhood,
      'address', p.address,
      'cover_image_url', CASE WHEN p.image_rights_status = 'cleared' THEN p.cover_image_url ELSE NULL END,
      'has_cover_image', p.image_rights_status = 'cleared' AND p.cover_image_url IS NOT NULL,
      'description', p.description,
      'veggie_reason', p.veggie_reason,
      'website_url', p.website_url,
      'google_maps_url', p.google_maps_url,
      'veggie_classification', p.veggie_classification,
      'maintenance_status', p.maintenance_status,
      'verification_freshness', freshness,
      'last_verified_at', COALESCE(p.last_reverified_at, p.verified_at)
    ),
    'my_support', jsonb_build_object(
      'verified_visit_count', my_visits,
      'last_verified_visit_at', my_last,
      'counts_toward_supported_places', counts_toward,
      'total_distinct_places_supported', supported_total,
      'check_in_available', can_check_in,
      'in_cooldown', my_last IS NOT NULL AND my_last > now() - INTERVAL '12 hours'
    ),
    'impact', jsonb_build_object(
      'supporter_count', CASE WHEN supporters >= 3 THEN supporters ELSE NULL END,
      'supporter_threshold_met', supporters >= 3,
      'upcoming_meetups', upcoming_count,
      'meetups_hosted', hosted_count
    ),
    'upcoming_meetups', meetups_json,
    'upcoming_meetups_total', upcoming_count,
    'can_host_here', can_host
  );
END; $function$;

REVOKE ALL ON FUNCTION public.get_community_place_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_community_place_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_community_place_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_community_place_detail(uuid) TO service_role;