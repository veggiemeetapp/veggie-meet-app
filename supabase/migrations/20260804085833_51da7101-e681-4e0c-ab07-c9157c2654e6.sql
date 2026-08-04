REVOKE ALL ON public.community_place_reverifications FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.community_place_reverifications FROM authenticated;
GRANT SELECT ON public.community_place_reverifications TO authenticated;
GRANT ALL ON public.community_place_reverifications TO service_role;