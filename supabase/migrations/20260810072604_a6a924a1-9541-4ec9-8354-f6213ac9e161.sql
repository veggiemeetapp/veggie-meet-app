REVOKE EXECUTE ON FUNCTION public.get_meetup_group(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_meetup_chat_message(uuid, text, uuid) FROM anon;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('send_dm_message','profile_is_eligible')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;