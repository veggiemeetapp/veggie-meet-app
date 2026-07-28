
-- Add public_status columns for safe status mapping
ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS public_status text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.meetup_reports
  ADD COLUMN IF NOT EXISTS public_status text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Public status mapping trigger
CREATE OR REPLACE FUNCTION public.map_report_public_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.public_status := CASE
    WHEN NEW.status IN ('open','submitted','pending') THEN 'submitted'
    WHEN NEW.status IN ('reviewing','in_review','under_review') THEN 'under_review'
    WHEN NEW.status LIKE 'resolved%' OR NEW.status IN ('closed','actioned','dismissed') THEN 'resolved'
    ELSE 'submitted'
  END;
  NEW.updated_at := now();
  IF NEW.public_status = 'resolved' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_user_reports_public_status ON public.user_reports;
CREATE TRIGGER trg_user_reports_public_status
BEFORE INSERT OR UPDATE ON public.user_reports
FOR EACH ROW EXECUTE FUNCTION public.map_report_public_status();

DROP TRIGGER IF EXISTS trg_meetup_reports_public_status ON public.meetup_reports;
CREATE TRIGGER trg_meetup_reports_public_status
BEFORE INSERT OR UPDATE ON public.meetup_reports
FOR EACH ROW EXECUTE FUNCTION public.map_report_public_status();

-- safety_reports table
CREATE TABLE IF NOT EXISTS public.safety_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 80),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  context_meetup_id UUID REFERENCES public.meetups(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'submitted',
  public_status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT, INSERT ON public.safety_reports TO authenticated;
GRANT ALL ON public.safety_reports TO service_role;
ALTER TABLE public.safety_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "safety_reports_reporter_read"
  ON public.safety_reports FOR SELECT TO authenticated
  USING (reporter_profile_id = public.current_profile_id());

CREATE POLICY "safety_reports_reporter_insert"
  ON public.safety_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_profile_id = public.current_profile_id());

DROP TRIGGER IF EXISTS trg_safety_reports_public_status ON public.safety_reports;
CREATE TRIGGER trg_safety_reports_public_status
BEFORE INSERT OR UPDATE ON public.safety_reports
FOR EACH ROW EXECUTE FUNCTION public.map_report_public_status();

-- Ensure reporter can read their own user_reports (was insert-only before)
DROP POLICY IF EXISTS "user_reports_reporter_select" ON public.user_reports;
CREATE POLICY "user_reports_reporter_select"
  ON public.user_reports FOR SELECT TO authenticated
  USING (reporter_profile_id = public.current_profile_id());

GRANT SELECT ON public.user_reports TO authenticated;

-- Canonical block RPCs
CREATE OR REPLACE FUNCTION public.block_profile(_blocked_profile_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID; row_id UUID;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _blocked_profile_id IS NULL OR _blocked_profile_id = me THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;
  INSERT INTO public.user_blocks (blocker_profile_id, blocked_profile_id)
    VALUES (me, _blocked_profile_id)
    ON CONFLICT (blocker_profile_id, blocked_profile_id) DO UPDATE SET blocker_profile_id = EXCLUDED.blocker_profile_id
    RETURNING id INTO row_id;
  RETURN row_id;
END; $$;

CREATE OR REPLACE FUNCTION public.unblock_profile(_blocked_profile_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.user_blocks
   WHERE blocker_profile_id = me
     AND blocked_profile_id = _blocked_profile_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_my_blocked_profiles()
RETURNS TABLE(
  block_id UUID,
  profile_id UUID,
  display_name text,
  avatar_url text,
  blocked_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ub.id, p.id, p.display_name, p.avatar_url, ub.created_at
    FROM public.user_blocks ub
    JOIN public.profiles p ON p.id = ub.blocked_profile_id
   WHERE ub.blocker_profile_id = public.current_profile_id()
   ORDER BY ub.created_at DESC;
$$;

-- Report submission RPCs
CREATE OR REPLACE FUNCTION public.submit_profile_report(
  _reported_profile_id UUID, _reason text, _details text, _conversation_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID; row_id UUID; clean_reason text; clean_details text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _reported_profile_id IS NULL OR _reported_profile_id = me THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;
  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL OR char_length(clean_reason) > 80 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')),'');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;
  INSERT INTO public.user_reports (reporter_profile_id, reported_profile_id, conversation_id, reason, details)
    VALUES (me, _reported_profile_id, _conversation_id, clean_reason, clean_details)
    RETURNING id INTO row_id;
  RETURN row_id;
END; $$;

CREATE OR REPLACE FUNCTION public.submit_message_report(
  _conversation_id UUID, _reported_profile_id UUID, _reason text, _details text
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.submit_profile_report(_reported_profile_id, _reason, _details, _conversation_id);
END; $$;

CREATE OR REPLACE FUNCTION public.submit_safety_report(
  _reason text, _details text, _context_meetup_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID; row_id UUID; clean_reason text; clean_details text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL OR char_length(clean_reason) > 80 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')),'');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;
  INSERT INTO public.safety_reports (reporter_profile_id, reason, details, context_meetup_id)
    VALUES (me, clean_reason, clean_details, _context_meetup_id)
    RETURNING id INTO row_id;
  RETURN row_id;
END; $$;

-- Unified reports RPC
CREATE OR REPLACE FUNCTION public.get_my_reports()
RETURNS TABLE(
  report_id UUID,
  subject_type text,
  subject_id UUID,
  subject_label text,
  reason text,
  details text,
  public_status text,
  created_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.id, 'profile'::text,
         ur.reported_profile_id,
         COALESCE(p.display_name, 'Veggie'),
         ur.reason, ur.details, ur.public_status, ur.created_at
    FROM public.user_reports ur
    LEFT JOIN public.profiles p ON p.id = ur.reported_profile_id
   WHERE ur.reporter_profile_id = public.current_profile_id()
  UNION ALL
  SELECT mr.id, 'meetup'::text,
         mr.meetup_id,
         COALESCE(m.title, 'Meetup'),
         mr.reason, mr.details, mr.public_status, mr.created_at
    FROM public.meetup_reports mr
    LEFT JOIN public.meetups m ON m.id = mr.meetup_id
   WHERE mr.reporter_profile_id = public.current_profile_id()
  UNION ALL
  SELECT sr.id, 'safety_concern'::text,
         sr.context_meetup_id,
         COALESCE(m.title, 'General safety concern'),
         sr.reason, sr.details, sr.public_status, sr.created_at
    FROM public.safety_reports sr
    LEFT JOIN public.meetups m ON m.id = sr.context_meetup_id
   WHERE sr.reporter_profile_id = public.current_profile_id()
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_my_report_detail(_subject_type text, _report_id UUID)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID; result jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _subject_type = 'profile' THEN
    SELECT jsonb_build_object(
      'subject_type','profile',
      'report_id', ur.id, 'reason', ur.reason, 'details', ur.details,
      'public_status', ur.public_status, 'created_at', ur.created_at,
      'subject', jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
    ) INTO result
    FROM public.user_reports ur LEFT JOIN public.profiles p ON p.id = ur.reported_profile_id
    WHERE ur.id = _report_id AND ur.reporter_profile_id = me;
  ELSIF _subject_type = 'meetup' THEN
    SELECT jsonb_build_object(
      'subject_type','meetup',
      'report_id', mr.id, 'reason', mr.reason, 'details', mr.details,
      'public_status', mr.public_status, 'created_at', mr.created_at,
      'subject', jsonb_build_object('id', m.id, 'title', m.title, 'date', m.date)
    ) INTO result
    FROM public.meetup_reports mr LEFT JOIN public.meetups m ON m.id = mr.meetup_id
    WHERE mr.id = _report_id AND mr.reporter_profile_id = me;
  ELSIF _subject_type = 'safety_concern' THEN
    SELECT jsonb_build_object(
      'subject_type','safety_concern',
      'report_id', sr.id, 'reason', sr.reason, 'details', sr.details,
      'public_status', sr.public_status, 'created_at', sr.created_at,
      'subject', jsonb_build_object('id', m.id, 'title', m.title)
    ) INTO result
    FROM public.safety_reports sr LEFT JOIN public.meetups m ON m.id = sr.context_meetup_id
    WHERE sr.id = _report_id AND sr.reporter_profile_id = me;
  END IF;
  IF result IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  RETURN result;
END; $$;

-- Add block check to verify_meetup_connection
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

  -- Block check
  IF public.is_blocked_between(me, tok.issuer_profile_id) THEN
    RETURN jsonb_build_object('kind','blocked');
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
