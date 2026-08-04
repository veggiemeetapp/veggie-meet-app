-- Remove the stray temp-table statement accidentally left in the WO-060 function body.
DO $$
DECLARE src text; newsrc text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_community_place_operations_dashboard';

  newsrc := replace(src, E'  CREATE TEMP TABLE IF NOT EXISTS _wo060 (x int) ON COMMIT DROP;\n\n', '');
  IF newsrc = src THEN
    RAISE NOTICE 'nothing to strip';
  ELSE
    EXECUTE newsrc;
  END IF;
END $$;