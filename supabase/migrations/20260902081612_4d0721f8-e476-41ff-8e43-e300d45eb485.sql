CREATE OR REPLACE FUNCTION public.get_meetup_invite_candidates(_meetup_id uuid)
 RETURNS TABLE(profile_id uuid, display_name text, first_name text, avatar_url text, city_name text, already_attending boolean, already_invited boolean, invitation_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meetups WHERE id = _meetup_id AND host_id = me) THEN
    RAISE EXCEPTION 'Only the host can invite Veggies to this Meetup';
  END IF;

  RETURN QUERY
  WITH connections AS (
    SELECT CASE WHEN f.profile_a_id = me THEN f.profile_b_id ELSE f.profile_a_id END AS other_id
    FROM public.friendships f
    WHERE (f.profile_a_id = me OR f.profile_b_id = me)
      AND f.status::text IN ('connected','verified')
  )
  SELECT
    p.id,
    p.display_name,
    COALESCE(NULLIF(split_part(p.display_name, ' ', 1), ''), p.display_name),
    p.avatar_url,
    c.name,
    EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.meetup_id = _meetup_id AND a.profile_id = p.id
        AND a.status::text NOT IN ('cancelled','removed')
    ),
    inv.id IS NOT NULL,
    inv.status::text
  FROM connections k
  JOIN public.profiles p ON p.id = k.other_id
  LEFT JOIN public.cities c ON c.id = p.home_city_id
  LEFT JOIN public.meetup_invitations inv
         ON inv.meetup_id = _meetup_id AND inv.recipient_id = p.id
  WHERE p.id <> me
    AND p.deleted_at IS NULL
    AND NOT public.is_blocked_between(me, p.id)
  ORDER BY p.display_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_meetup_invite_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meetup_invite_candidates(uuid) TO authenticated;