REVOKE ALL ON public.community_place_visits FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.community_place_visits FROM authenticated;
GRANT SELECT ON public.community_place_visits TO authenticated;

REVOKE ALL ON FUNCTION public.check_in_to_community_place(uuid, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_place_check_in_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_to_community_place(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_place_check_in_state(uuid) TO authenticated;