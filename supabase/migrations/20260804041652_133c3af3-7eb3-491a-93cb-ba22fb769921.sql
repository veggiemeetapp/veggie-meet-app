DO $$
DECLARE d text; d2 text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'update_meetup_location'
   LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'update_meetup_location not found'; END IF;

  d2 := replace(
    d,
    'AND verification_status = ''verified'';',
    'AND verification_status = ''verified''
       AND COALESCE(maintenance_status, ''operational'') = ''operational'';'
  );
  IF d2 = d THEN RAISE EXCEPTION 'expected place verification check not found'; END IF;
  EXECUTE d2;
END $$;