REVOKE EXECUTE ON FUNCTION public.submit_community_place_report(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_place_reports() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_place_report_queue() FROM anon;
REVOKE EXECUTE ON FUNCTION public.moderate_community_place_report(uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._notify_place_report(uuid, uuid, text, text) FROM anon, authenticated;