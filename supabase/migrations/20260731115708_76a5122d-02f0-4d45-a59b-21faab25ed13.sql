-- Helper: is the caller the host or a live attendee of this meetup?
CREATE OR REPLACE FUNCTION public.is_meetup_member(_meetup_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetups m
    WHERE m.id = _meetup_id AND m.host_id = public.current_profile_id()
  ) OR EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.meetup_id = _meetup_id
      AND a.profile_id = public.current_profile_id()
      AND a.status NOT IN ('cancelled','removed')
  );
$$;

-- Helper: does the caller share a meetup, chat, or DM with this profile?
CREATE OR REPLACE FUNCTION public.shares_context_with(_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  );
$$;

REVOKE ALL ON FUNCTION public.is_meetup_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shares_context_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_meetup_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_context_with(uuid) TO authenticated;

-- ATTENDANCE: scope roster reads to that meetup's host / attendees
DROP POLICY IF EXISTS "Members can view attendance rosters" ON public.attendance;
CREATE POLICY "Members can view attendance rosters"
  ON public.attendance FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_meetup_member(meetup_id));

-- PLACE CHECK-INS: own, connections, or discoverable profiles only
DROP POLICY IF EXISTS "Signed-in users can view place check-ins" ON public.place_check_ins;
CREATE POLICY "Bounded place check-in visibility"
  ON public.place_check_ins FOR SELECT TO authenticated
  USING (
    profile_id = public.current_profile_id()
    OR public.are_connected(public.current_profile_id(), profile_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_id AND p.discovery_visible)
  );

-- PROFILES: respect discovery opt-out
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Bounded profile visibility"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR discovery_visible
    OR public.are_connected(public.current_profile_id(), id)
    OR public.shares_context_with(id)
  );