GRANT EXECUTE ON FUNCTION public.meetup_interest_score(text, text[], text[]) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.canonical_interest_labels(text[]) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.canonical_interest_ids(text[]) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.resolve_interest_id(text) TO supabase_read_only_user;