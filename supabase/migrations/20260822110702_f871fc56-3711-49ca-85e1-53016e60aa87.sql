DO $mig$
DECLARE d text; n int;
BEGIN
  -- 1) to_plan (My Plans)
  d := pg_get_functiondef('public.to_plan(anyelement)'::regprocedure);
  d := replace(d, $q$'category', r.category,$q$,
                  $q$'category', r.category, 'primary_interest_id', r.primary_interest_id, 'additional_interest_ids', COALESCE(r.additional_interest_ids, ARRAY[]::text[]),$q$);
  IF position($q$'primary_interest_id', r.primary_interest_id$q$ in d) = 0 THEN
    RAISE EXCEPTION 'to_plan patch failed';
  END IF;
  EXECUTE d;

  -- 2) get_my_you_summary
  d := pg_get_functiondef('public.get_my_you_summary(integer)'::regprocedure);
  d := replace(d, $q$m.id AS meetup_id, m.title, m.category::text AS category,$q$,
                  $q$m.id AS meetup_id, m.title, m.category::text AS category, m.primary_interest_id, m.additional_interest_ids,$q$);
  d := replace(d, $q$'category', l.category,$q$,
                  $q$'category', l.category, 'primary_interest_id', l.primary_interest_id, 'additional_interest_ids', COALESCE(l.additional_interest_ids, ARRAY[]::text[]),$q$);
  IF position($q$'primary_interest_id', l.primary_interest_id$q$ in d) = 0
     OR position($q$m.primary_interest_id, m.additional_interest_ids,$q$ in d) = 0 THEN
    RAISE EXCEPTION 'get_my_you_summary patch failed';
  END IF;
  EXECUTE d;

  -- 3) search_meetups
  d := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='search_meetups' LIMIT 1));
  d := replace(d, $q$'category', p.category,$q$,
                  $q$'category', p.category, 'primary_interest_id', p.primary_interest_id, 'additional_interest_ids', COALESCE(p.additional_interest_ids, ARRAY[]::text[]),$q$);
  IF position($q$'primary_interest_id', p.primary_interest_id$q$ in d) = 0 THEN
    RAISE EXCEPTION 'search_meetups patch failed';
  END IF;
  EXECUTE d;

  -- 4) get_my_today_experience
  d := pg_get_functiondef('public.get_my_today_experience()'::regprocedure);
  d := replace(d, $q$'title', f.title, 'category', f.category,$q$,
                  $q$'title', f.title, 'category', f.category, 'primary_interest_id', f.primary_interest_id, 'additional_interest_ids', COALESCE(f.additional_interest_ids, ARRAY[]::text[]),$q$);
  IF position($q$'primary_interest_id', f.primary_interest_id$q$ in d) = 0 THEN
    RAISE EXCEPTION 'get_my_today_experience patch failed';
  END IF;
  EXECUTE d;
END $mig$;