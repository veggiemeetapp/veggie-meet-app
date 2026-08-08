CREATE OR REPLACE FUNCTION public.get_my_suppressed_profile_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT CASE
               WHEN ub.blocker_profile_id = public.current_profile_id()
                 THEN ub.blocked_profile_id
               ELSE ub.blocker_profile_id
             END
      FROM public.user_blocks ub
      WHERE public.current_profile_id() IS NOT NULL
        AND (ub.blocker_profile_id = public.current_profile_id()
             OR ub.blocked_profile_id = public.current_profile_id())
    ),
    ARRAY[]::uuid[]
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_suppressed_profile_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_suppressed_profile_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_suppressed_profile_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_suppressed_profile_ids() TO service_role;