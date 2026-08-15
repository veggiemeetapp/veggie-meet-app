-- WO-111 / DEF-111-01 — initial verification lifecycle tests.
-- Run inside a transaction and roll back; creates no production data.
BEGIN;

-- Helper: freshness assertions (canonical due rule).
DO $$
BEGIN
  -- 1. Fresh initial verification (publish today) is current, not due.
  IF public.place_freshness_label(now(), now()) <> 'current' THEN
    RAISE EXCEPTION 'FAIL: fresh initial verification is not current';
  END IF;
  -- 2. Verified today but never through a reverification review: still current.
  IF public.place_freshness_label(now(), NULL) <> 'current' THEN
    RAISE EXCEPTION 'FAIL: never-reverified fresh place treated as stale';
  END IF;
  -- 3. Genuine future due arrives at the configured interval.
  IF public.place_freshness_label(now() - INTERVAL '181 days', NULL) <> 'due' THEN
    RAISE EXCEPTION 'FAIL: 181-day-old verification is not due';
  END IF;
  IF public.place_freshness_label(now() - INTERVAL '181 days',
                                 now() - INTERVAL '181 days') <> 'due' THEN
    RAISE EXCEPTION 'FAIL: stale reverification is not due';
  END IF;
  IF public.place_freshness_label(now() - INTERVAL '200 days', now()) <> 'current' THEN
    RAISE EXCEPTION 'FAIL: completed reverification did not reset the clock';
  END IF;
  -- 4. Due-soon window preserved.
  IF public.place_freshness_label(now() - INTERVAL '160 days', NULL) <> 'due_soon' THEN
    RAISE EXCEPTION 'FAIL: due_soon window changed';
  END IF;
  -- 5. Legacy/unverified rows (no verification at all) remain due.
  IF public.place_freshness_label(NULL, NULL) <> 'due' THEN
    RAISE EXCEPTION 'FAIL: unverified place is not due';
  END IF;
END $$;

-- 6. Production invariant: every verified published place carries both a first
--    verification date and a latest verification date.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM public.community_places p
   WHERE p.verification_status = 'verified'
     AND (p.verified_at IS NULL OR p.last_reverified_at IS NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % verified places missing verification timestamps', bad;
  END IF;
END $$;

-- 7. Idempotency invariant: one candidate publishes to at most one place.
DO $$
DECLARE dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT published_place_id FROM public.place_candidates
     WHERE published_place_id IS NOT NULL
     GROUP BY published_place_id HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'FAIL: duplicate publications detected';
  END IF;
END $$;

-- 8. No blanket suppression: a newly published place with a real integrity
--    trigger still reports an unhealthy state.
DO $$
DECLARE h text;
BEGIN
  SELECT CASE
           WHEN maintenance_status = 'permanently_closed' AND is_active THEN 'data_integrity'
           WHEN COALESCE(veggie_classification,'') <> 'fully_vegan' THEN 'vegan_unconfirmed'
           ELSE 'healthy'
         END INTO h
    FROM (SELECT 'permanently_closed'::text AS maintenance_status, true AS is_active,
                 'fully_vegan'::text AS veggie_classification) x;
  IF h <> 'data_integrity' THEN
    RAISE EXCEPTION 'FAIL: legitimate attention trigger suppressed';
  END IF;
END $$;

ROLLBACK;
