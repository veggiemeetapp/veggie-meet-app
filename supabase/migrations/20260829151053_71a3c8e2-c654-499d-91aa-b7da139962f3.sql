-- WO-140: make Meetup report submission idempotent per (reporter, meetup, reason)
-- while an earlier report is still open, so rapid/duplicate submissions cannot
-- create duplicate moderation rows. Reporter identity stays server-derived.

CREATE UNIQUE INDEX IF NOT EXISTS meetup_reports_open_unique
  ON public.meetup_reports (meetup_id, reporter_profile_id, reason)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.report_meetup(_meetup_id uuid, _reason text, _details text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; m RECORD; clean_reason text; clean_details text; row_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean_reason := NULLIF(btrim(COALESCE(_reason,'')), '');
  IF clean_reason IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF NOT public._valid_report_reason('meetup', clean_reason) THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')), '');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;
  SELECT id, host_id INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  -- Idempotent: an open report from this member for the same Meetup and reason
  -- is returned as-is instead of duplicated.
  SELECT id INTO row_id
  FROM public.meetup_reports
  WHERE meetup_id = _meetup_id
    AND reporter_profile_id = me
    AND reason = clean_reason
    AND status = 'open'
  LIMIT 1;
  IF row_id IS NOT NULL THEN RETURN row_id; END IF;

  INSERT INTO public.meetup_reports (meetup_id, reporter_profile_id, host_profile_id, reason, details)
  VALUES (_meetup_id, me, m.host_id, clean_reason, clean_details)
  ON CONFLICT (meetup_id, reporter_profile_id, reason) WHERE status = 'open'
  DO UPDATE SET updated_at = now()
  RETURNING id INTO row_id;
  RETURN row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_meetup(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_meetup(uuid, text, text) TO authenticated;