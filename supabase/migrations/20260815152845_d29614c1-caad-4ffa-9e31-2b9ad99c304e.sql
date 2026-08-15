REVOKE ALL ON FUNCTION public._place_unaccent(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._place_name_key(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._place_brand_key(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._place_addr_key(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._place_suggestion_match_context(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.check_community_place_suggestion_duplicate(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.submit_community_place_suggestion(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_place_suggestion_queue(text) FROM anon;
REVOKE ALL ON FUNCTION public.promote_place_suggestion_to_candidate(uuid) FROM anon;