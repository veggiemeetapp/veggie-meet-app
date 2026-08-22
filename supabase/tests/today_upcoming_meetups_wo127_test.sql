-- WO-127 backend invariants for Today's Upcoming Meetups.
--
-- Shared eligibility contract (public.eligible_upcoming_meetups_for_viewer):
--   a Meetup is an "eligible upcoming Meetup" for a viewer when it is
--   not cancelled, not completed, its authoritative end timestamp (Meetup
--   timezone) is still in the future, its host profile is active, neither party
--   is blocked, and it belongs to the viewer's selected city (or has no city).
--
-- Hosting, attendance, primary-action/check-in selection and interest score
-- must NOT remove a Meetup — they may only rank or label it.
--
-- Read-only: the test asserts against existing records and creates nothing.

DO $$
DECLARE
  v_me uuid;
  v_city uuid;
  v_hosted uuid;
  v_cnt int;
  v_is_host boolean;
  v_end timestamptz;
BEGIN
  SELECT m.host_id, m.city_id, m.id
    INTO v_me, v_city, v_hosted
  FROM public.meetups m
  WHERE m.status <> 'cancelled'::meetup_status
    AND m.cancelled_at IS NULL
  ORDER BY m.date DESC
  LIMIT 1;

  IF v_me IS NULL THEN
    RAISE NOTICE 'WO-127: no Meetups present — nothing to assert';
    RETURN;
  END IF;

  -- 1. A future Meetup hosted by the viewer is eligible and flagged is_host.
  SELECT count(*), bool_and(e.is_host)
    INTO v_cnt, v_is_host
  FROM public.eligible_upcoming_meetups_for_viewer(v_me, v_city) e
  WHERE e.id = v_hosted
    AND e.end_at > now();
  IF (SELECT public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) > now()
      FROM public.meetups m WHERE m.id = v_hosted) THEN
    ASSERT v_cnt = 1, 'hosted future Meetup must be eligible for its host';
    ASSERT v_is_host, 'hosted Meetup must report is_host = true';
  END IF;

  -- 2. Eligibility never depends on the viewer: every row returned for the host
  --    is also returned for any other member of the same city (modulo blocks).
  SELECT count(*) INTO v_cnt
  FROM public.eligible_upcoming_meetups_for_viewer(v_me, v_city) a
  FULL JOIN public.eligible_upcoming_meetups_for_viewer(
      (SELECT p.id FROM public.profiles p WHERE p.id <> v_me AND p.deleted_at IS NULL LIMIT 1), v_city) b
    ON a.id = b.id
  WHERE a.id IS NULL OR b.id IS NULL;
  ASSERT v_cnt = 0, 'eligibility must not vary by host/attendance relationship';

  -- 3. Authoritative end boundary: nothing already ended is returned.
  SELECT count(*) INTO v_cnt
  FROM public.eligible_upcoming_meetups_for_viewer(v_me, v_city) e
  WHERE e.end_at <= now();
  ASSERT v_cnt = 0, 'ended Meetups must be excluded by the end boundary';

  -- 4. Cancelled and completed Meetups stay excluded.
  SELECT count(*) INTO v_cnt
  FROM public.eligible_upcoming_meetups_for_viewer(v_me, v_city) e
  JOIN public.meetups m ON m.id = e.id
  WHERE m.status = 'cancelled'::meetup_status
     OR m.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = m.id);
  ASSERT v_cnt = 0, 'cancelled/completed Meetups must be excluded';

  -- 5. Selected-city scoping uses the authoritative city id, never a city string.
  SELECT count(*) INTO v_cnt
  FROM public.eligible_upcoming_meetups_for_viewer(v_me, v_city) e
  WHERE e.meetup_city_id IS NOT NULL AND e.meetup_city_id <> v_city;
  ASSERT v_cnt = 0, 'no cross-city leakage';

  -- 6. Timezone: the Aug 26 13:00 Asia/Ho_Chi_Minh Meetup is upcoming on Aug 22.
  SELECT public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone)
    INTO v_end
  FROM public.meetups m WHERE m.date = DATE '2026-08-26' LIMIT 1;
  IF v_end IS NOT NULL THEN
    ASSERT v_end > (TIMESTAMPTZ '2026-08-22 14:00:00+00'),
      'Aug 26 Meetup must still be upcoming for a viewer on Aug 22 (Asia/Ho_Chi_Minh)';
  END IF;

  -- 7. The helper is internal only.
  ASSERT NOT has_function_privilege('authenticated',
      'public.eligible_upcoming_meetups_for_viewer(uuid,uuid)', 'EXECUTE'),
    'shared eligibility helper must not be callable by signed-in users';
  ASSERT NOT has_function_privilege('anon',
      'public.eligible_upcoming_meetups_for_viewer(uuid,uuid)', 'EXECUTE'),
    'shared eligibility helper must not be callable anonymously';

  RAISE NOTICE 'WO-127 invariants passed';
END $$;
