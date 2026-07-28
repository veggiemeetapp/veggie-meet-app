
REVOKE EXECUTE ON FUNCTION public.block_profile(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.unblock_profile(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_blocked_profiles() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.submit_profile_report(UUID, text, text, UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.submit_message_report(UUID, UUID, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.submit_safety_report(text, text, UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_reports() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_report_detail(text, UUID) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.block_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_blocked_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_profile_report(UUID, text, text, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_message_report(UUID, UUID, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_safety_report(text, text, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_report_detail(text, UUID) TO authenticated;
