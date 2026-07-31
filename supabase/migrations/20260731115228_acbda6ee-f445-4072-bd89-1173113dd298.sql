DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS t, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.t);
    IF r.relname IN ('cities','interest_catalogue') THEN
      EXECUTE format('GRANT SELECT ON TABLE %s TO anon', r.t);
    END IF;
  END LOOP;
END $$;