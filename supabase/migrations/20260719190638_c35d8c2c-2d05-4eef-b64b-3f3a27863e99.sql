CREATE OR REPLACE FUNCTION public.verify_meetup_connection(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  UPDATE public.attendance
     SET status = 'checked_in'::attendance_status,
         checked_in_at = COALESCE(checked_in_at, now())
   WHERE meetup_id = tok.meetup_id
     AND profile_id IN (me, tok.issuer_profile_id)
     AND status = 'joined'::attendance_status;

  -- Global pair-verification check: one verified pair record exists across ALL meetups.
  SELECT id INTO existing FROM public.verified_meetup_connections
   WHERE profile_a_id = a AND profile_b_id = b LIMIT 1;
  IF existing IS NOT NULL THEN
    SELECT p.id, p.display_name, p.avatar_url INTO peer_row FROM public.profiles p WHERE p.id = tok.issuer_profile_id;
    RETURN jsonb_build_object('kind','already_verified',
      'peer', jsonb_build_object('id', peer_row.id, 'display_name', peer_row.display_name, 'avatar_url', peer_row.avatar_url));
  END IF;

  INSERT INTO public.verified_meetup_connections (profile_a_id, profile_b_id, meetup_id, scanned_by, token_issuer_id)
  VALUES (a, b, tok.meetup_id, me, tok.issuer_profile_id);

  INSERT INTO public.friendships (profile_a_id, profile_b_id, first_meetup_id, friends_since, status, requester_id)
  VALUES (a, b, tok.meetup_id, CURRENT_DATE, 'verified', me)
  ON CONFLICT (profile_a_id, profile_b_id) DO UPDATE
    SET status = 'verified',
        first_meetup_id = COALESCE(public.friendships.first_meetup_id, EXCLUDED.first_meetup_id),
        friends_since   = LEAST(public.friendships.friends_since, EXCLUDED.friends_since);

  SELECT p.id, p.display_name, p.avatar_url INTO peer_row FROM public.profiles p WHERE p.id = tok.issuer_profile_id;
  RETURN jsonb_build_object('kind','verified',
    'peer', jsonb_build_object('id', peer_row.id, 'display_name', peer_row.display_name, 'avatar_url', peer_row.avatar_url));
END; $function$;