-- WO-066 fix: restore read-only member access to attendance (writes stay RPC-only)
GRANT SELECT (id, profile_id, meetup_id, status, joined_at, checked_in_at, created_at, updated_at)
  ON public.attendance TO authenticated;
