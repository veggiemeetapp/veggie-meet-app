REVOKE EXECUTE ON FUNCTION public._legit_hosted_meetup_ids(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._legit_place_supports(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._legit_verified_pairs(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.meetup_has_ended(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.meetup_in_check_in_window(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_viewer_city_id(uuid) FROM authenticated;