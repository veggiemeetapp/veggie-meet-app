DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance','check_in_requests','dm_conversations','dm_messages','friendships','meetup_feedback','meetup_invitations','meetups','messages','notifications','recommendation_feedback','verified_meetup_connections']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.check_in_requests REPLICA IDENTITY FULL;
ALTER TABLE public.dm_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.dm_messages REPLICA IDENTITY FULL;
ALTER TABLE public.friendships REPLICA IDENTITY FULL;
ALTER TABLE public.meetups REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;