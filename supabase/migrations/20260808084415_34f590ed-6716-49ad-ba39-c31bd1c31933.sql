REVOKE EXECUTE ON FUNCTION public.get_meetup_chat_context(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_meetup_chat_thread(uuid, timestamptz, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_meetup_chat_message(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_read_meetup_chat(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_post_meetup_chat(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.meetup_chat_meetup_id(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.meetup_chat_post_block_reason(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_chat_roster_from_attendance() FROM anon, authenticated;