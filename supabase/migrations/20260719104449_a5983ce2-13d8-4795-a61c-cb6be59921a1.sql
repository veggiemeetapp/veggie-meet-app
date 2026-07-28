ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.meetups REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.meetups;    EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;