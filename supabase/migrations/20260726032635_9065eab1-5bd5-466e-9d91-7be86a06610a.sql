
REVOKE EXECUTE ON FUNCTION public.search_veggies(text, uuid, boolean, text[], text[], int, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_meetups(text, uuid, boolean, text[], date, date, text, text, boolean, int, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_community_places(text, uuid, boolean, text[], text, int, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_all(text, uuid, boolean, int) FROM PUBLIC, anon;
