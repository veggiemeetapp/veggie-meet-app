REVOKE ALL ON FUNCTION public.dm_cleared_at(UUID, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_dm_conversation_for_me(UUID) FROM anon;