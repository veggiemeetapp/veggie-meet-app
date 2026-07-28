ALTER TABLE public.friendships REPLICA IDENTITY FULL;
ALTER TABLE public.check_in_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
ALTER PUBLICATION supabase_realtime ADD TABLE public.check_in_requests;