DO $$
BEGIN
  IF (SELECT count(*) FROM public.check_in_requests) <> 0 THEN
    RAISE EXCEPTION 'WO-065 abort: check_in_requests contains % row(s)', (SELECT count(*) FROM public.check_in_requests);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE meetups_hosted_count <> 0
        OR meetups_attended_count <> 0
        OR veggies_met_count <> 0
  ) THEN
    RAISE EXCEPTION 'WO-065 abort: legacy profile counters contain non-zero data';
  END IF;
END $$;

-- Retired legacy QR/check-in request architecture (superseded by
-- meetup_qr_tokens + verify_meetup_connection + verified_meetup_connections).
DROP TRIGGER IF EXISTS trg_check_in_confirmed ON public.check_in_requests;
DROP TRIGGER IF EXISTS set_check_in_requests_updated_at ON public.check_in_requests;
DROP TABLE IF EXISTS public.check_in_requests;
DROP FUNCTION IF EXISTS public.handle_check_in_confirmed();

-- Legacy mutable Community Impact counters (never written; impact is derived by
-- _legit_verified_pairs / _legit_place_supports / _legit_hosted_meetup_ids).
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS meetups_hosted_count,
  DROP COLUMN IF EXISTS meetups_attended_count,
  DROP COLUMN IF EXISTS veggies_met_count;