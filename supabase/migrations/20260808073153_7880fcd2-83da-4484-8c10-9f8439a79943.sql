REVOKE EXECUTE ON FUNCTION public.block_profile(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unblock_profile(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_pair_blocked(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_and_block_profile(uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_member_report_queue(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_member_report_status(uuid, text) FROM anon;