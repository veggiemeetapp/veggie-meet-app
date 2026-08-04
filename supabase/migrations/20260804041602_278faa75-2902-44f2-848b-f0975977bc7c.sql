REVOKE ALL ON FUNCTION public.set_community_place_status(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reverify_community_place(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_community_place_maintenance() FROM anon;
REVOKE ALL ON FUNCTION public.get_community_place_status_history(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.enforce_meetup_community_place() FROM PUBLIC, anon, authenticated;