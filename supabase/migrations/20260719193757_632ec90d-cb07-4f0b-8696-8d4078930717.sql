
-- Rating enum
DO $$ BEGIN
  CREATE TYPE public.meetup_feedback_rating AS ENUM ('great','okay','not_for_me');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) meetup_feedback
CREATE TABLE IF NOT EXISTS public.meetup_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id uuid NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  experience_rating public.meetup_feedback_rating NOT NULL,
  private_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetup_feedback_unique UNIQUE (meetup_id, profile_id),
  CONSTRAINT meetup_feedback_note_len CHECK (private_note IS NULL OR char_length(private_note) <= 500)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetup_feedback TO authenticated;
GRANT ALL ON public.meetup_feedback TO service_role;
ALTER TABLE public.meetup_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own feedback" ON public.meetup_feedback
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());
CREATE POLICY "Users insert own feedback" ON public.meetup_feedback
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());
CREATE POLICY "Users update own feedback" ON public.meetup_feedback
  FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());
CREATE POLICY "Users delete own feedback" ON public.meetup_feedback
  FOR DELETE TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE TRIGGER meetup_feedback_updated_at
  BEFORE UPDATE ON public.meetup_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) meetup_follow_up_state
CREATE TABLE IF NOT EXISTS public.meetup_follow_up_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id uuid NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  prompted_at timestamptz,
  dismissed_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetup_follow_up_state_unique UNIQUE (meetup_id, profile_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetup_follow_up_state TO authenticated;
GRANT ALL ON public.meetup_follow_up_state TO service_role;
ALTER TABLE public.meetup_follow_up_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own follow up" ON public.meetup_follow_up_state
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());
CREATE POLICY "Users write own follow up" ON public.meetup_follow_up_state
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());
CREATE POLICY "Users update own follow up" ON public.meetup_follow_up_state
  FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());

CREATE TRIGGER meetup_follow_up_state_updated_at
  BEFORE UPDATE ON public.meetup_follow_up_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) meetup_reports
CREATE TABLE IF NOT EXISTS public.meetup_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id uuid NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  reporter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  host_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetup_reports_reason_len CHECK (char_length(reason) BETWEEN 1 AND 80),
  CONSTRAINT meetup_reports_details_len CHECK (details IS NULL OR char_length(details) <= 1000)
);
GRANT SELECT, INSERT ON public.meetup_reports TO authenticated;
GRANT ALL ON public.meetup_reports TO service_role;
ALTER TABLE public.meetup_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own meetup reports" ON public.meetup_reports
  FOR SELECT TO authenticated
  USING (reporter_profile_id = public.current_profile_id());
CREATE POLICY "Users insert own meetup reports" ON public.meetup_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_profile_id = public.current_profile_id());

-- Helpers
CREATE OR REPLACE FUNCTION public.meetup_has_ended(_meetup_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetups m
    WHERE m.id = _meetup_id
      AND m.status <> 'cancelled'::meetup_status
      AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
  );
$$;

-- RPC: submit_meetup_feedback
CREATE OR REPLACE FUNCTION public.submit_meetup_feedback(
  _meetup_id uuid,
  _rating public.meetup_feedback_rating,
  _note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; att_status text; m RECORD; clean text; row_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup was cancelled.';
  END IF;
  IF (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) > now() THEN
    RAISE EXCEPTION 'This Meetup has not ended yet.';
  END IF;

  SELECT status::text INTO att_status FROM public.attendance
   WHERE meetup_id = _meetup_id AND profile_id = me
   ORDER BY updated_at DESC LIMIT 1;
  IF att_status IS NULL OR att_status IN ('cancelled','removed') THEN
    RAISE EXCEPTION 'Only attendees can leave feedback.';
  END IF;
  IF att_status NOT IN ('checked_in','attended') THEN
    RAISE EXCEPTION 'Only checked-in attendees can leave feedback.';
  END IF;

  clean := NULLIF(btrim(COALESCE(_note,'')), '');
  IF clean IS NOT NULL AND char_length(clean) > 500 THEN
    RAISE EXCEPTION 'Note too long';
  END IF;

  INSERT INTO public.meetup_feedback (meetup_id, profile_id, experience_rating, private_note)
  VALUES (_meetup_id, me, _rating, clean)
  ON CONFLICT (meetup_id, profile_id) DO UPDATE
    SET experience_rating = EXCLUDED.experience_rating,
        private_note = EXCLUDED.private_note,
        updated_at = now()
  RETURNING id INTO row_id;
  RETURN row_id;
END;
$$;

-- RPC: mark_meetup_follow_up_viewed
CREATE OR REPLACE FUNCTION public.mark_meetup_follow_up_viewed(_meetup_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.meetup_follow_up_state (meetup_id, profile_id, prompted_at, viewed_at)
  VALUES (_meetup_id, me, now(), now())
  ON CONFLICT (meetup_id, profile_id) DO UPDATE
    SET viewed_at = COALESCE(public.meetup_follow_up_state.viewed_at, now()),
        prompted_at = COALESCE(public.meetup_follow_up_state.prompted_at, now()),
        updated_at = now();
END;
$$;

-- RPC: dismiss_meetup_follow_up
CREATE OR REPLACE FUNCTION public.dismiss_meetup_follow_up(_meetup_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.meetup_follow_up_state (meetup_id, profile_id, prompted_at, dismissed_at)
  VALUES (_meetup_id, me, now(), now())
  ON CONFLICT (meetup_id, profile_id) DO UPDATE
    SET dismissed_at = now(),
        prompted_at = COALESCE(public.meetup_follow_up_state.prompted_at, now()),
        updated_at = now();
END;
$$;

-- RPC: get_my_meetup_summary (attendee)
CREATE OR REPLACE FUNCTION public.get_my_meetup_summary(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; m RECORD; att_status text; place jsonb; host jsonb; verified jsonb; feedback jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  SELECT status::text INTO att_status FROM public.attendance
   WHERE meetup_id = _meetup_id AND profile_id = me
   ORDER BY updated_at DESC LIMIT 1;

  IF att_status IS NULL THEN
    RAISE EXCEPTION 'You did not attend this Meetup.';
  END IF;

  -- Host
  SELECT to_jsonb(p) - 'auth_user_id' INTO host
    FROM (SELECT id, display_name, avatar_url FROM public.profiles WHERE id = m.host_id) p;

  -- Place
  IF m.community_place_id IS NOT NULL THEN
    SELECT to_jsonb(cp) INTO place
      FROM (SELECT id, name, cover_image_url, address FROM public.community_places WHERE id = m.community_place_id) cp;
  END IF;

  -- Verified connections at this meetup involving me
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO verified
  FROM (
    SELECT p.id, p.display_name, p.avatar_url, p.interests
      FROM public.verified_meetup_connections v
      JOIN public.profiles p
        ON p.id = CASE WHEN v.profile_a_id = me THEN v.profile_b_id ELSE v.profile_a_id END
     WHERE v.meetup_id = _meetup_id
       AND (v.profile_a_id = me OR v.profile_b_id = me)
     ORDER BY v.verified_at ASC
  ) x;

  -- My feedback
  SELECT to_jsonb(f) INTO feedback FROM (
    SELECT id, experience_rating::text AS rating, private_note, created_at, updated_at
      FROM public.meetup_feedback WHERE meetup_id = _meetup_id AND profile_id = me
  ) f;

  RETURN jsonb_build_object(
    'meetup', jsonb_build_object(
      'id', m.id, 'title', m.title, 'description', m.description,
      'date', m.date, 'start_time', m.start_time, 'end_time', m.end_time,
      'cover_image_url', m.cover_image_url,
      'custom_location_name', m.custom_location_name,
      'custom_location_address', m.custom_location_address,
      'status', m.status,
      'cancelled_at', m.cancelled_at,
      'has_ended', (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
    ),
    'host', host,
    'place', place,
    'attendance_status', att_status,
    'is_host', (m.host_id = me),
    'verified_connections', verified,
    'feedback', feedback
  );
END;
$$;

-- RPC: get_host_meetup_summary (host)
CREATE OR REPLACE FUNCTION public.get_host_meetup_summary(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; m RECORD; confirmed_count int; checked_in_count int; verified_count int;
        great_count int; okay_count int; not_for_me_count int; total_feedback int; threshold_met boolean;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You do not host this Meetup.'; END IF;

  SELECT count(*) INTO confirmed_count FROM public.attendance
    WHERE meetup_id = _meetup_id AND status::text NOT IN ('cancelled','removed');
  SELECT count(*) INTO checked_in_count FROM public.attendance
    WHERE meetup_id = _meetup_id AND status::text IN ('checked_in','attended');
  SELECT count(*) INTO verified_count FROM public.verified_meetup_connections
    WHERE meetup_id = _meetup_id;

  SELECT
    count(*) FILTER (WHERE experience_rating = 'great'),
    count(*) FILTER (WHERE experience_rating = 'okay'),
    count(*) FILTER (WHERE experience_rating = 'not_for_me'),
    count(*)
  INTO great_count, okay_count, not_for_me_count, total_feedback
  FROM public.meetup_feedback WHERE meetup_id = _meetup_id;

  threshold_met := total_feedback >= 3;

  RETURN jsonb_build_object(
    'meetup', jsonb_build_object(
      'id', m.id, 'title', m.title,
      'date', m.date, 'start_time', m.start_time, 'end_time', m.end_time,
      'status', m.status,
      'has_ended', (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
    ),
    'confirmed_count', confirmed_count,
    'checked_in_count', checked_in_count,
    'attendance_rate', CASE WHEN confirmed_count > 0 THEN round((checked_in_count::numeric / confirmed_count) * 100, 0) ELSE NULL END,
    'verified_connections_count', verified_count,
    'feedback', jsonb_build_object(
      'total', total_feedback,
      'threshold_met', threshold_met,
      'great', CASE WHEN threshold_met THEN great_count ELSE NULL END,
      'okay', CASE WHEN threshold_met THEN okay_count ELSE NULL END,
      'not_for_me', CASE WHEN threshold_met THEN not_for_me_count ELSE NULL END
    )
  );
END;
$$;

-- RPC: report_meetup
CREATE OR REPLACE FUNCTION public.report_meetup(_meetup_id uuid, _reason text, _details text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; m RECORD; clean_reason text; clean_details text; row_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  clean_reason := NULLIF(btrim(COALESCE(_reason,'')), '');
  IF clean_reason IS NULL OR char_length(clean_reason) > 80 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')), '');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;
  SELECT id, host_id INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  INSERT INTO public.meetup_reports (meetup_id, reporter_profile_id, host_profile_id, reason, details)
  VALUES (_meetup_id, me, m.host_id, clean_reason, clean_details)
  RETURNING id INTO row_id;
  RETURN row_id;
END;
$$;
