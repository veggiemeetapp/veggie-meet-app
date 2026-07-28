
-- WO-030 Meetup Check-In & Verified Connections

-- 1. QR token table
CREATE TABLE public.meetup_qr_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meetup_id UUID NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meetup_qr_tokens TO authenticated;
GRANT ALL ON public.meetup_qr_tokens TO service_role;
ALTER TABLE public.meetup_qr_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Issuer can view own tokens" ON public.meetup_qr_tokens
  FOR SELECT TO authenticated USING (issuer_profile_id = public.current_profile_id());
-- No INSERT/UPDATE/DELETE policies: only SECURITY DEFINER RPCs touch this table.
CREATE INDEX ON public.meetup_qr_tokens (issuer_profile_id, meetup_id);
CREATE INDEX ON public.meetup_qr_tokens (expires_at);

-- 2. Verified pair records
CREATE TABLE public.verified_meetup_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id UUID NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  profile_a_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_b_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scanned_by UUID NOT NULL REFERENCES public.profiles(id),
  token_issuer_id UUID NOT NULL REFERENCES public.profiles(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT verified_pair_order CHECK (profile_a_id < profile_b_id),
  CONSTRAINT verified_pair_unique UNIQUE (profile_a_id, profile_b_id)
);
GRANT SELECT ON public.verified_meetup_connections TO authenticated;
GRANT ALL ON public.verified_meetup_connections TO service_role;
ALTER TABLE public.verified_meetup_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants can view their verifications"
  ON public.verified_meetup_connections FOR SELECT TO authenticated
  USING (
    profile_a_id = public.current_profile_id()
    OR profile_b_id = public.current_profile_id()
  );
CREATE INDEX ON public.verified_meetup_connections (meetup_id);

-- 3. Check-in window helper
CREATE OR REPLACE FUNCTION public.meetup_in_check_in_window(_meetup_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m RECORD; opens TIMESTAMPTZ; closes TIMESTAMPTZ;
BEGIN
  SELECT date, start_time, end_time, status INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RETURN 'missing'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN RETURN 'cancelled'; END IF;
  opens := (m.date + m.start_time) - INTERVAL '60 minutes';
  closes := (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) + INTERVAL '4 hours';
  IF now() < opens THEN RETURN 'too_early'; END IF;
  IF now() > closes THEN RETURN 'closed'; END IF;
  RETURN 'open';
END; $$;

-- 4. Issue QR token RPC
CREATE OR REPLACE FUNCTION public.issue_meetup_qr_token(_meetup_id UUID)
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID; raw TEXT; hash TEXT; ttl INTERVAL := INTERVAL '3 minutes'; win TEXT; is_attending BOOLEAN;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  win := public.meetup_in_check_in_window(_meetup_id);
  IF win = 'missing' THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF win = 'cancelled' THEN RAISE EXCEPTION 'This Meetup was cancelled.'; END IF;
  IF win = 'too_early' THEN RAISE EXCEPTION 'Check-in opens closer to the Meetup.'; END IF;
  IF win = 'closed' THEN RAISE EXCEPTION 'Check-in for this Meetup has ended.'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
      AND status::text NOT IN ('cancelled','removed')
  ) INTO is_attending;
  IF NOT is_attending THEN
    RAISE EXCEPTION 'You must be attending this Meetup to generate a check-in code.';
  END IF;

  -- Revoke prior active tokens for this issuer+meetup so a "refresh" is real.
  UPDATE public.meetup_qr_tokens
     SET revoked_at = now()
   WHERE issuer_profile_id = me AND meetup_id = _meetup_id
     AND revoked_at IS NULL AND expires_at > now();

  raw := encode(gen_random_bytes(24), 'hex'); -- 48 hex chars
  hash := encode(digest(raw, 'sha256'), 'hex');

  INSERT INTO public.meetup_qr_tokens (issuer_profile_id, meetup_id, token_hash, expires_at)
  VALUES (me, _meetup_id, hash, now() + ttl);

  RETURN QUERY SELECT raw, (now() + ttl);
END; $$;

-- 5. Verify RPC
-- Returns JSONB: { kind: 'verified'|'already_verified', peer_id, meetup_id }
CREATE OR REPLACE FUNCTION public.verify_meetup_connection(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID; hash TEXT; tok RECORD; win TEXT;
  a UUID; b UUID;
  fr RECORD; already BOOLEAN := false;
  peer UUID; meetup_id UUID;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'Invalid code'; END IF;

  hash := encode(digest(_token, 'sha256'), 'hex');
  SELECT * INTO tok FROM public.meetup_qr_tokens
    WHERE token_hash = hash FOR UPDATE;
  IF tok IS NULL THEN RAISE EXCEPTION 'Invalid code'; END IF;
  IF tok.revoked_at IS NOT NULL OR tok.expires_at <= now() THEN
    RAISE EXCEPTION 'This QR has expired. Ask them to refresh it.';
  END IF;
  IF tok.issuer_profile_id = me THEN
    RAISE EXCEPTION 'You can''t scan your own QR code.';
  END IF;

  peer := tok.issuer_profile_id;
  meetup_id := tok.meetup_id;

  win := public.meetup_in_check_in_window(meetup_id);
  IF win = 'cancelled' THEN RAISE EXCEPTION 'This Meetup was cancelled.'; END IF;
  IF win = 'too_early' THEN RAISE EXCEPTION 'Check-in opens closer to the Meetup.'; END IF;
  IF win = 'closed' THEN RAISE EXCEPTION 'Check-in for this Meetup has ended.'; END IF;
  IF win <> 'open' THEN RAISE EXCEPTION 'Check-in unavailable'; END IF;

  -- Both actively attending
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = me AND meetup_id = verify_meetup_connection.meetup_id
      AND status::text NOT IN ('cancelled','removed')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = peer AND meetup_id = verify_meetup_connection.meetup_id
      AND status::text NOT IN ('cancelled','removed')
  ) THEN
    RAISE EXCEPTION 'Both people must be confirmed attendees of this Meetup.';
  END IF;

  IF public.is_blocked_between(me, peer) THEN
    RAISE EXCEPTION 'Verification is not available.';
  END IF;

  -- Must already be mutually connected (connected or verified). QR never creates a relationship.
  a := LEAST(me, peer); b := GREATEST(me, peer);
  SELECT * INTO fr FROM public.friendships
    WHERE profile_a_id = a AND profile_b_id = b FOR UPDATE;
  IF fr IS NULL OR fr.status NOT IN ('connected'::friendship_status, 'verified'::friendship_status) THEN
    RAISE EXCEPTION 'You need to be connected before verifying that you met.';
  END IF;

  IF fr.status = 'verified'::friendship_status THEN
    already := true;
  END IF;

  -- Upgrade attendance to checked_in for both (if currently 'joined')
  UPDATE public.attendance
     SET status = 'checked_in'::attendance_status,
         checked_in_at = COALESCE(checked_in_at, now()),
         updated_at = now()
   WHERE meetup_id = verify_meetup_connection.meetup_id
     AND profile_id IN (me, peer)
     AND status = 'joined'::attendance_status;

  IF NOT already THEN
    UPDATE public.friendships
       SET status = 'verified'::friendship_status,
           first_meetup_id = COALESCE(first_meetup_id, verify_meetup_connection.meetup_id),
           friends_since = LEAST(friends_since, CURRENT_DATE)
     WHERE id = fr.id;
  END IF;

  -- Insert pair record (idempotent via unique constraint)
  BEGIN
    INSERT INTO public.verified_meetup_connections
      (meetup_id, profile_a_id, profile_b_id, scanned_by, token_issuer_id)
    VALUES (verify_meetup_connection.meetup_id, a, b, me, peer);
  EXCEPTION WHEN unique_violation THEN
    already := true;
  END;

  RETURN jsonb_build_object(
    'kind', CASE WHEN already THEN 'already_verified' ELSE 'verified' END,
    'peer_id', peer,
    'meetup_id', verify_meetup_connection.meetup_id
  );
END; $$;

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.verified_meetup_connections;

-- Ensure pgcrypto for digest/gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto;
