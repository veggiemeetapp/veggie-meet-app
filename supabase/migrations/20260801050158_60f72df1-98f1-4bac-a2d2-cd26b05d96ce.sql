REVOKE ALL ON public.place_candidates FROM anon;
REVOKE ALL ON public.owner_allowlist FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_place_candidate(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_place_candidate(uuid, text) FROM anon;