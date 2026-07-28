
REVOKE ALL ON FUNCTION public._insert_notification(uuid,uuid,public.notification_type,text,uuid,text,uuid,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_friendship_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_invitation_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_meetup_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
