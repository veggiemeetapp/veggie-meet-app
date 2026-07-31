CREATE OR REPLACE FUNCTION public.shares_context_with(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT public.current_profile_id() AS id)
  SELECT EXISTS (
    SELECT 1 FROM public.attendance a1
    JOIN public.attendance a2 ON a2.meetup_id = a1.meetup_id
    WHERE a1.profile_id = (SELECT id FROM me) AND a2.profile_id = _profile_id
  ) OR EXISTS (
    SELECT 1 FROM public.meetups m
    WHERE (m.host_id = (SELECT id FROM me)
           AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.meetup_id = m.id AND a.profile_id = _profile_id))
       OR (m.host_id = _profile_id
           AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.meetup_id = m.id AND a.profile_id = (SELECT id FROM me)))
  ) OR EXISTS (
    SELECT 1 FROM public.chat_participants c1
    JOIN public.chat_participants c2 ON c2.chat_id = c1.chat_id
    WHERE c1.profile_id = (SELECT id FROM me) AND c2.profile_id = _profile_id
  ) OR EXISTS (
    SELECT 1 FROM public.dm_conversations d
    WHERE (d.user_a_id = (SELECT id FROM me) AND d.user_b_id = _profile_id)
       OR (d.user_b_id = (SELECT id FROM me) AND d.user_a_id = _profile_id)
  ) OR EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'pending'
      AND ((f.profile_a_id = (SELECT id FROM me) AND f.profile_b_id = _profile_id)
        OR (f.profile_b_id = (SELECT id FROM me) AND f.profile_a_id = _profile_id))
  );
$function$;