
REVOKE ALL ON public.community_place_identity_reviews FROM anon, authenticated;
REVOKE ALL ON public.community_place_identity_history FROM anon, authenticated;
GRANT SELECT ON public.community_place_identity_reviews TO authenticated;
GRANT SELECT ON public.community_place_identity_history TO authenticated;
GRANT ALL ON public.community_place_identity_reviews TO service_role;
GRANT ALL ON public.community_place_identity_history TO service_role;

REVOKE ALL ON public.community_place_suggestions FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.community_place_suggestions FROM authenticated;
GRANT SELECT, INSERT ON public.community_place_suggestions TO authenticated;
GRANT ALL ON public.community_place_suggestions TO service_role;
