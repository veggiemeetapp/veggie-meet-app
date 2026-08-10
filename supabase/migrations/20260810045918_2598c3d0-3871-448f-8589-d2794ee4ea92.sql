CREATE OR REPLACE FUNCTION public.get_meetup_group(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  m RECORD;
  suppressed uuid[];
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  IF NOT public.is_meetup_member(_meetup_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  suppressed := public.get_my_suppressed_profile_ids();

  RETURN jsonb_build_object(
    'found', true,
    'meetup', jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'date', m.date,
      'start_time', m.start_time,
      'end_time', m.end_time,
      'status', m.status,
      'timezone', m.timezone,
      'location_name', COALESCE(m.location_name, m.custom_location_name),
      'address', COALESCE(m.address, m.custom_location_address),
      'chat_id', (SELECT c.id FROM public.chats c WHERE c.meetup_id = m.id LIMIT 1),
      'is_host', m.host_id = me
    ),
    'host', (
      SELECT jsonb_build_object(
               'id', p.id,
               'display_name', CASE WHEN p.deleted_at IS NOT NULL THEN 'Former member'
                                    ELSE p.display_name END,
               'avatar_url', CASE WHEN p.deleted_at IS NOT NULL THEN NULL ELSE p.avatar_url END,
               'current_city', CASE WHEN p.deleted_at IS NOT NULL THEN NULL ELSE p.current_city END,
               'interests', CASE WHEN p.deleted_at IS NOT NULL THEN '[]'::jsonb
                                 ELSE to_jsonb(p.interests) END,
               'is_you', p.id = me,
               'is_available', p.deleted_at IS NULL AND NOT (p.id = ANY(suppressed))
             )
      FROM public.profiles p WHERE p.id = m.host_id
    ),
    'attendees', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'display_name')
      FROM (
        SELECT jsonb_build_object(
                 'id', p.id,
                 'display_name', CASE WHEN p.deleted_at IS NOT NULL THEN 'Former member'
                                      ELSE p.display_name END,
                 'avatar_url', CASE WHEN p.deleted_at IS NOT NULL THEN NULL ELSE p.avatar_url END,
                 'current_city', CASE WHEN p.deleted_at IS NOT NULL THEN NULL ELSE p.current_city END,
                 'interests', CASE WHEN p.deleted_at IS NOT NULL THEN '[]'::jsonb
                                   ELSE to_jsonb(p.interests) END,
                 'is_you', p.id = me,
                 'is_available', p.deleted_at IS NULL AND NOT (p.id = ANY(suppressed))
               ) AS x
        FROM public.attendance a
        JOIN public.profiles p ON p.id = a.profile_id
        WHERE a.meetup_id = m.id
          AND a.status NOT IN ('cancelled','removed')
          AND p.id <> m.host_id
      ) s
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_meetup_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meetup_group(uuid) TO authenticated;