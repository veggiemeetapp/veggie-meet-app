REVOKE ALL ON FUNCTION public.get_my_plans(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_plans(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_plans(text, integer) TO authenticated;