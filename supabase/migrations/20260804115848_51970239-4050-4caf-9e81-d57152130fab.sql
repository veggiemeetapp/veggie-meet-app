REVOKE ALL ON public.community_place_vegan_reviews FROM anon, authenticated;
REVOKE ALL ON public.community_place_vegan_classification_history FROM anon, authenticated;

GRANT SELECT ON public.community_place_vegan_reviews TO authenticated;
GRANT SELECT ON public.community_place_vegan_classification_history TO authenticated;
GRANT ALL ON public.community_place_vegan_reviews TO service_role;
GRANT ALL ON public.community_place_vegan_classification_history TO service_role;