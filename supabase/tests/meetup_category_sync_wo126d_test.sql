-- WO-126D — the internal compatibility enum meetups.category must stay derived
-- from the canonical Primary interest on BOTH create and edit.
--
-- Invariant (run as a privileged role):
--   every meetup with a canonical Primary interest satisfies
--   category = public.legacy_meetup_category_for_interest(primary_interest_id)
DO $$
DECLARE drifted int;
BEGIN
  SELECT count(*) INTO drifted
  FROM public.meetups m
  WHERE m.primary_interest_id IS NOT NULL
    AND m.category IS DISTINCT FROM
        public.legacy_meetup_category_for_interest(m.primary_interest_id);

  IF drifted > 0 THEN
    RAISE EXCEPTION 'WO-126D invariant failed: % meetup(s) have a stale legacy category', drifted;
  END IF;

  -- The approved deterministic mapping (spot checks).
  ASSERT public.legacy_meetup_category_for_interest('hiking') = 'walk'::public.meetup_category;
  ASSERT public.legacy_meetup_category_for_interest('coffee') = 'coffee'::public.meetup_category;
  ASSERT public.legacy_meetup_category_for_interest('yoga')   = 'other'::public.meetup_category;
END $$;
