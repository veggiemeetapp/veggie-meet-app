REVOKE ALL ON FUNCTION public.get_today_place_curation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_today_place_state(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reorder_today_featured_places(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_today_featured_ranks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_today_place_curation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_today_place_state(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_today_featured_places(uuid, uuid[]) TO authenticated;
