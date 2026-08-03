REVOKE EXECUTE ON FUNCTION public.submit_community_place_suggestion(uuid,text,text,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_place_suggestions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_place_suggestion_queue() FROM anon;
REVOKE EXECUTE ON FUNCTION public.moderate_place_suggestion(uuid,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_place_suggestion_to_candidate(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._suggestion_norm(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._suggestion_norm(text) FROM authenticated;