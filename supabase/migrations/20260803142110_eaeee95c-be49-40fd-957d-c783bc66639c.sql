-- WO-048: retire legacy place check-in system.
-- Pre-cleanup row count for public.place_check_ins = 0 (verified before running).

-- 1. Rewrite get_my_today_experience so "supported" places come from the
--    authoritative verified-visits table instead of place_check_ins.
DO $wo048$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('public.get_my_today_experience()'::regprocedure);
  d := replace(
    d,
    'SELECT DISTINCT community_place_id AS place_id FROM place_check_ins WHERE profile_id = me',
    'SELECT DISTINCT v.community_place_id::text AS place_id FROM community_place_visits v WHERE v.profile_id = me AND v.verification_status = ''verified'''
  );
  IF d ILIKE '%place_check_ins%' THEN
    RAISE EXCEPTION 'get_my_today_experience still references place_check_ins';
  END IF;
  EXECUTE d;
END
$wo048$;

-- 2. Drop the legacy activation trigger + its function (used only by this table).
DROP TRIGGER IF EXISTS trg_activation_place_checkin ON public.place_check_ins;
DROP FUNCTION IF EXISTS public.trg_activation_place_checkin();

-- 3. Drop the legacy table last (policies + indexes go with it).
--    Safety guard: refuse if any row exists.
DO $wo048b$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.place_check_ins;
  IF n <> 0 THEN
    RAISE EXCEPTION 'place_check_ins is not empty (% rows) - aborting drop', n;
  END IF;
END
$wo048b$;

DROP TABLE IF EXISTS public.place_check_ins;