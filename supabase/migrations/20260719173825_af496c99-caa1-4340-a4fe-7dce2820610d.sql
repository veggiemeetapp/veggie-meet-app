
CREATE OR REPLACE FUNCTION public.issue_meetup_qr_token(_meetup_id UUID)
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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

  raw := encode(extensions.gen_random_bytes(24), 'hex');
  hash := encode(extensions.digest(raw, 'sha256'), 'hex');
  exp := now() + ttl;

  INSERT INTO public.meetup_qr_tokens (issuer_profile_id, meetup_id, token_hash, expires_at)
  VALUES (me, _meetup_id, hash, exp);

  token := raw;
  expires_at := exp;
  RETURN NEXT;
END; $$;

-- Fix verify_meetup_connection's digest call as well
CREATE OR REPLACE FUNCTION public.verify_meetup_connection(_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  me UUID; tok RECORD; win TEXT; both_attending BOOLEAN; connected BOOLEAN;
  a UUID; b UUID; existing UUID; peer_row RECORD; hash TEXT;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _token IS NULL OR length(_token) < 8 THEN
    RETURN jsonb_build_object('kind','invalid');
  END IF;

  hash := encode(extensions.digest(_token, 'sha256'), 'hex');

  SELECT t.* INTO tok FROM public.meetup_qr_tokens t WHERE t.token_hash = hash LIMIT 1;
  IF tok IS NULL THEN RETURN jsonb_build_object('kind','invalid'); END IF;
  IF tok.revoked_at IS NOT NULL OR tok.expires_at <= now() THEN
    RETURN jsonb_build_object('kind','expired');
  END IF;
  IF tok.issuer_profile_id = me THEN
    RETURN jsonb_build_object('kind','self');
  END IF;

  win := public.meetup_in_check_in_window(tok.meetup_id);
  IF win = 'cancelled' THEN RETURN jsonb_build_object('kind','cancelled'); END IF;
  IF win = 'too_early' THEN RETURN jsonb_build_object('kind','too_early'); END IF;
  IF win = 'closed' THEN RETURN jsonb_build_object('kind','closed'); END IF;
  IF win <> 'open' THEN RETURN jsonb_build_object('kind','invalid'); END IF;

  SELECT
    EXISTS (SELECT 1 FROM public.attendance x WHERE x.profile_id = me AND x.meetup_id = tok.meetup_id AND x.status::text NOT IN ('cancelled','removed'))
    AND
    EXISTS (SELECT 1 FROM public.attendance x WHERE x.profile_id = tok.issuer_profile_id AND x.meetup_id = tok.meetup_id AND x.status::text NOT IN ('cancelled','removed'))
    INTO both_attending;
  IF NOT both_attending THEN RETURN jsonb_build_object('kind','not_attending'); END IF;

  connected := public.are_connected(me, tok.issuer_profile_id);
  IF NOT connected THEN
    RETURN jsonb_build_object('kind','not_connected',
      'peer', jsonb_build_object('id', tok.issuer_profile_id));
  END IF;

  a := LEAST(me, tok.issuer_profile_id);
  b := GREATEST(me, tok.issuer_profile_id);

  SELECT id INTO existing FROM public.verified_meetup_connections
   WHERE profile_a_id = a AND profile_b_id = b AND meetup_id = tok.meetup_id LIMIT 1;
  IF existing IS NOT NULL THEN
    SELECT p.id, p.display_name, p.avatar_url INTO peer_row FROM public.profiles p WHERE p.id = tok.issuer_profile_id;
    RETURN jsonb_build_object('kind','already_verified',
      'peer', jsonb_build_object('id', peer_row.id, 'display_name', peer_row.display_name, 'avatar_url', peer_row.avatar_url));
  END IF;

  INSERT INTO public.verified_meetup_connections (profile_a_id, profile_b_id, meetup_id, scanned_by)
  VALUES (a, b, tok.meetup_id, me);

  INSERT INTO public.friendships (profile_a_id, profile_b_id, first_meetup_id, friends_since, status, requester_id)
  VALUES (a, b, tok.meetup_id, CURRENT_DATE, 'verified', me)
  ON CONFLICT (profile_a_id, profile_b_id) DO UPDATE
    SET status = 'verified',
        first_meetup_id = COALESCE(public.friendships.first_meetup_id, EXCLUDED.first_meetup_id),
        friends_since   = LEAST(public.friendships.friends_since, EXCLUDED.friends_since);

  SELECT p.id, p.display_name, p.avatar_url INTO peer_row FROM public.profiles p WHERE p.id = tok.issuer_profile_id;
  RETURN jsonb_build_object('kind','verified',
    'peer', jsonb_build_object('id', peer_row.id, 'display_name', peer_row.display_name, 'avatar_url', peer_row.avatar_url));
END; $$;
