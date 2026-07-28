
CREATE OR REPLACE FUNCTION public.issue_meetup_qr_token(_meetup_id UUID)
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID; raw TEXT; hash TEXT; ttl INTERVAL := INTERVAL '3 minutes'; win TEXT; is_attending BOOLEAN; exp TIMESTAMPTZ;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  win := public.meetup_in_check_in_window(_meetup_id);
  IF win = 'missing' THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF win = 'cancelled' THEN RAISE EXCEPTION 'This Meetup was cancelled.'; END IF;
  IF win = 'too_early' THEN RAISE EXCEPTION 'Check-in opens closer to the Meetup.'; END IF;
  IF win = 'closed' THEN RAISE EXCEPTION 'Check-in for this Meetup has ended.'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.profile_id = me AND a.meetup_id = _meetup_id
      AND a.status::text NOT IN ('cancelled','removed')
  ) INTO is_attending;
  IF NOT is_attending THEN
    RAISE EXCEPTION 'You must be attending this Meetup to generate a check-in code.';
  END IF;

  UPDATE public.meetup_qr_tokens t
     SET revoked_at = now()
   WHERE t.issuer_profile_id = me AND t.meetup_id = _meetup_id
     AND t.revoked_at IS NULL AND t.expires_at > now();

  raw := encode(gen_random_bytes(24), 'hex');
  hash := encode(digest(raw, 'sha256'), 'hex');
  exp := now() + ttl;

  INSERT INTO public.meetup_qr_tokens (issuer_profile_id, meetup_id, token_hash, expires_at)
  VALUES (me, _meetup_id, hash, exp);

  token := raw;
  expires_at := exp;
  RETURN NEXT;
END; $$;
