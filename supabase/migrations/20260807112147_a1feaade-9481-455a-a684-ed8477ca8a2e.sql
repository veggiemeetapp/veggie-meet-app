REVOKE EXECUTE ON FUNCTION public.get_meetup_place_context(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_meetup_current_place_location(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._meetup_place_integrity(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._meetup_place_integrity(uuid) TO service_role;