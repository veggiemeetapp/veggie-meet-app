-- ============ 1. ATTENDANCE (P0) ============
DROP POLICY IF EXISTS "Attendance is viewable by everyone" ON public.attendance;
REVOKE SELECT ON public.attendance FROM anon;
REVOKE SELECT ON public.attendance FROM authenticated;
GRANT SELECT (id, profile_id, meetup_id, status, joined_at, checked_in_at, created_at, updated_at)
  ON public.attendance TO authenticated;
CREATE POLICY "Members can view attendance rosters"
  ON public.attendance FOR SELECT TO authenticated USING (true);

-- ============ 2. MEETUPS (P1) ============
DROP POLICY IF EXISTS "Meetups are viewable by everyone" ON public.meetups;
REVOKE SELECT ON public.meetups FROM anon;
CREATE POLICY "Signed-in users can view meetups"
  ON public.meetups FOR SELECT TO authenticated USING (true);

-- ============ 3. COMMUNITY PLACES ============
DROP POLICY IF EXISTS "Places are viewable by everyone" ON public.community_places;
DROP POLICY IF EXISTS "Authenticated users can add places" ON public.community_places;
REVOKE SELECT, INSERT ON public.community_places FROM anon;
REVOKE INSERT ON public.community_places FROM authenticated;
CREATE POLICY "Signed-in users can view places"
  ON public.community_places FOR SELECT TO authenticated USING (true);

-- ============ 4. FRIENDSHIPS (P1) ============
DROP POLICY IF EXISTS "Signed-in users can view established friendships" ON public.friendships;
DROP POLICY IF EXISTS "Participants can update friendships" ON public.friendships;
DROP POLICY IF EXISTS "Participants can delete friendships" ON public.friendships;
CREATE POLICY "Participants can update friendships"
  ON public.friendships FOR UPDATE TO authenticated
  USING (profile_a_id = current_profile_id() OR profile_b_id = current_profile_id())
  WITH CHECK (profile_a_id = current_profile_id() OR profile_b_id = current_profile_id());
CREATE POLICY "Participants can delete friendships"
  ON public.friendships FOR DELETE TO authenticated
  USING (profile_a_id = current_profile_id() OR profile_b_id = current_profile_id());

CREATE OR REPLACE FUNCTION public.get_profile_connection_summary(_target_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT current_profile_id() AS pid),
  target_conn AS (
    SELECT CASE WHEN profile_a_id = _target_profile_id THEN profile_b_id ELSE profile_a_id END AS other
    FROM friendships
    WHERE status IN ('connected','verified')
      AND _target_profile_id IN (profile_a_id, profile_b_id)
  ),
  my_conn AS (
    SELECT CASE WHEN profile_a_id = (SELECT pid FROM me) THEN profile_b_id ELSE profile_a_id END AS other
    FROM friendships
    WHERE status IN ('connected','verified')
      AND (SELECT pid FROM me) IN (profile_a_id, profile_b_id)
  ),
  mutual AS (
    SELECT p.id, p.display_name, p.avatar_url
    FROM profiles p
    WHERE p.id IN (SELECT other FROM target_conn INTERSECT SELECT other FROM my_conn)
      AND p.id <> (SELECT pid FROM me)
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'verified_connections', (
      SELECT count(*) FROM friendships
      WHERE status = 'verified' AND _target_profile_id IN (profile_a_id, profile_b_id)
    ),
    'mutual_connections', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'profileId', id, 'displayName', display_name, 'avatarUrl', avatar_url)) FROM mutual),
      '[]'::jsonb)
  )
  WHERE (SELECT pid FROM me) IS NOT NULL;
$$;

-- ============ 5. STORAGE: meetup-covers ownership scoping ============
DROP POLICY IF EXISTS "Authenticated upload meetup covers" ON storage.objects;
CREATE POLICY "Users upload own meetup cover"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meetup-covers'
              AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users update own meetup cover" ON storage.objects;
CREATE POLICY "Users update own meetup cover"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'meetup-covers'
         AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'meetup-covers'
              AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users delete own meetup cover" ON storage.objects;
CREATE POLICY "Users delete own meetup cover"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meetup-covers'
         AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============ 6. FUNCTION EXECUTE least privilege ============
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig,
           p.prorettype = 'trigger'::regtype AS is_trigger,
           p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    IF r.is_trigger OR r.proname = '_insert_notification' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;