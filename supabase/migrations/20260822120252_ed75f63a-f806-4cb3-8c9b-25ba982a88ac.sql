DO $mig$
DECLARE def text; newdef text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_my_plans';

  newdef := replace(
    def,
    'b.id AS meetup_id, b.title, b.cover_image_url, b.category::text AS category,',
    'b.id AS meetup_id, b.title, b.cover_image_url, b.category::text AS category, b.primary_interest_id, COALESCE(b.additional_interest_ids, ARRAY[]::text[]) AS additional_interest_ids,'
  );

  IF newdef = def THEN
    RAISE EXCEPTION 'DEF-126B-01 patch anchor not found in get_my_plans';
  END IF;

  EXECUTE newdef;
END
$mig$;