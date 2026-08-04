REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.community_places FROM authenticated;
REVOKE ALL ON public.community_places FROM anon;
GRANT SELECT ON public.community_places TO authenticated;

REVOKE ALL ON public.community_place_status_history FROM anon;
REVOKE ALL ON public.community_place_status_history FROM authenticated;
GRANT SELECT ON public.community_place_status_history TO authenticated;
GRANT ALL ON public.community_places TO service_role;
GRANT ALL ON public.community_place_status_history TO service_role;