-- WO-040 Batch 8: dedupe overlapping triggers created by historical migrations.
-- Each dropped trigger has a same-behavior sibling still attached (verified in
-- information_schema.triggers) so behavior is preserved.

DROP TRIGGER IF EXISTS trg_handle_new_attendance ON public.attendance;
DROP TRIGGER IF EXISTS set_updated_at_attendance ON public.attendance;
DROP TRIGGER IF EXISTS set_updated_at_chats ON public.chats;
DROP TRIGGER IF EXISTS check_in_confirmed_trg ON public.check_in_requests;
DROP TRIGGER IF EXISTS set_updated_at_community_places ON public.community_places;
DROP TRIGGER IF EXISTS trg_canonicalize_friendship ON public.friendships;
DROP TRIGGER IF EXISTS set_updated_at_profiles ON public.profiles;