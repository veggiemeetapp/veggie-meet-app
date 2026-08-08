-- Caller-scoped block check for use inside RLS policies. Unlike
-- is_blocked_between(a,b) this cannot be used to probe the block relationship
-- between two arbitrary third parties: one side is always the caller.
CREATE OR REPLACE FUNCTION public.is_blocked_with_me(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks ub
    WHERE (ub.blocker_profile_id = public.current_profile_id()
           AND ub.blocked_profile_id = _profile_id)
       OR (ub.blocker_profile_id = _profile_id
           AND ub.blocked_profile_id = public.current_profile_id())
  );
$$;

REVOKE ALL ON FUNCTION public.is_blocked_with_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_blocked_with_me(uuid) TO authenticated;

DROP POLICY IF EXISTS "Bounded profile visibility" ON public.profiles;
CREATE POLICY "Bounded profile visibility"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR (
    onboarding_completed
    AND NOT public.is_blocked_with_me(id)
    AND (
      discovery_visible
      OR public.are_connected(public.current_profile_id(), id)
      OR public.shares_context_with(id)
    )
  )
);
