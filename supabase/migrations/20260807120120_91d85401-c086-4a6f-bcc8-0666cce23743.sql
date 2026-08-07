-- 1. Canonical completion audit table
CREATE TABLE public.meetup_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meetup_id uuid NOT NULL UNIQUE REFERENCES public.meetups(id) ON DELETE RESTRICT,
  host_id uuid NOT NULL REFERENCES public.profiles(id),
  completed_at timestamptz NOT NULL DEFAULT now(),
  completion_method text NOT NULL DEFAULT 'host_confirmed',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meetup_completions TO authenticated;
GRANT ALL ON public.meetup_completions TO service_role;

ALTER TABLE public.meetup_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read completions for meetups they can see"
  ON public.meetup_completions FOR SELECT TO authenticated
  USING (host_id = public.current_profile_id() OR public.is_meetup_member(meetup_id));

CREATE INDEX meetup_completions_host_idx ON public.meetup_completions(host_id);

-- append-only guard
CREATE OR REPLACE FUNCTION public.guard_meetup_completions_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'meetup_completions is append-only';
END; $$;

CREATE TRIGGER guard_meetup_completions_ud
  BEFORE UPDATE OR DELETE ON public.meetup_completions
  FOR EACH ROW EXECUTE FUNCTION public.guard_meetup_completions_append_only();

-- 2. Completed Meetups are historical: immutable and non-deletable
CREATE OR REPLACE FUNCTION public.guard_completed_meetup_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'This Meetup is completed and part of your hosting history. It can''t be deleted.';
    END IF;
    IF to_jsonb(NEW) - 'updated_at' <> to_jsonb(OLD) - 'updated_at' THEN
      RAISE EXCEPTION 'This Meetup is completed. Completed Meetups can''t be changed.';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE TRIGGER zzz_guard_completed_meetup
  BEFORE UPDATE OR DELETE ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.guard_completed_meetup_immutable();

-- 3. Server-authoritative, idempotent completion
CREATE OR REPLACE FUNCTION public.complete_hosted_meetup(_meetup_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; m RECORD; ends_at timestamptz; others int; existing RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _meetup_id IS NULL THEN RAISE EXCEPTION 'Meetup required'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;

  SELECT * INTO existing FROM public.meetup_completions WHERE meetup_id = _meetup_id;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('result','already_completed','completed_at',existing.completed_at);
  END IF;

  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'Cancelled Meetups can''t be completed.';
  END IF;

  ends_at := (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))::timestamptz;
  IF ends_at > now() THEN
    RAISE EXCEPTION 'This Meetup hasn''t ended yet.';
  END IF;

  SELECT count(*) INTO others FROM public.attendance a
   WHERE a.meetup_id = _meetup_id
     AND a.profile_id <> me
     AND a.status::text IN ('checked_in','attended');
  IF others < 1 THEN
    RAISE EXCEPTION 'At least one other Veggie needs to have checked in before this Meetup can be completed.';
  END IF;

  UPDATE public.meetups
     SET status = 'past'::meetup_status, updated_at = now()
   WHERE id = _meetup_id;

  INSERT INTO public.meetup_completions (meetup_id, host_id, completion_method)
  VALUES (_meetup_id, me, 'host_confirmed')
  ON CONFLICT (meetup_id) DO NOTHING;

  RETURN jsonb_build_object(
    'result','completed',
    'completed_at',(SELECT completed_at FROM public.meetup_completions WHERE meetup_id = _meetup_id)
  );
END; $$;

REVOKE ALL ON FUNCTION public.complete_hosted_meetup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_hosted_meetup(uuid) TO authenticated;

-- 4. Member-safe lifecycle read model
CREATE OR REPLACE FUNCTION public.get_meetup_lifecycle(_meetup_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; m RECORD; c RECORD; ends_at timestamptz; starts_at timestamptz;
        others int; is_host boolean; state text; blocked text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  is_host := (m.host_id = me);
  SELECT * INTO c FROM public.meetup_completions WHERE meetup_id = _meetup_id;
  starts_at := (m.date + m.start_time)::timestamptz;
  ends_at := (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours'))::timestamptz;

  state := CASE
    WHEN m.status = 'cancelled'::meetup_status THEN 'cancelled'
    WHEN c.id IS NOT NULL THEN 'completed'
    WHEN ends_at <= now() THEN 'ended'
    WHEN starts_at <= now() THEN 'in_progress'
    ELSE 'upcoming' END;

  IF is_host AND c.id IS NULL THEN
    SELECT count(*) INTO others FROM public.attendance a
     WHERE a.meetup_id = _meetup_id AND a.profile_id <> me
       AND a.status::text IN ('checked_in','attended');
    blocked := CASE
      WHEN m.status = 'cancelled'::meetup_status THEN 'cancelled'
      WHEN ends_at > now() THEN 'not_ended'
      WHEN others < 1 THEN 'no_checked_in_attendees'
      ELSE NULL END;
  END IF;

  RETURN jsonb_build_object(
    'meetup_id', m.id,
    'lifecycle_state', state,
    'has_started', starts_at <= now(),
    'has_ended', ends_at <= now(),
    'is_completed', c.id IS NOT NULL,
    'completed_at', c.completed_at,
    'counts_toward_hosting_impact', (c.id IS NOT NULL AND m.status <> 'cancelled'::meetup_status),
    'is_host', is_host,
    'can_complete', COALESCE(is_host AND c.id IS NULL AND blocked IS NULL, false),
    'blocked_reason', blocked,
    'server_time', now()
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_meetup_lifecycle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meetup_lifecycle(uuid) TO authenticated;

-- 5. Hosting impact now derives ONLY from canonical completion records
CREATE OR REPLACE FUNCTION public._legit_hosted_meetup_ids(_profile_id uuid)
RETURNS TABLE(meetup_id uuid, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT c.meetup_id, c.completed_at
    FROM public.meetup_completions c
    JOIN public.meetups m ON m.id = c.meetup_id
   WHERE c.host_id = _profile_id
     AND m.host_id = _profile_id
     AND m.status <> 'cancelled'::meetup_status;
$$;

-- 6. Places Supported isolation: only verified visits count (no Meetup attendance)
CREATE OR REPLACE FUNCTION public._legit_place_supports(_profile_id uuid)
RETURNS TABLE(community_place_id uuid, first_supported_at timestamptz, first_meetup_id uuid, last_supported_at timestamptz, visits integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.community_place_id,
         MIN(v.visited_at) AS first_supported_at,
         NULL::uuid        AS first_meetup_id,
         MAX(v.visited_at) AS last_supported_at,
         COUNT(*)::int     AS visits
    FROM public.community_place_visits v
   WHERE v.profile_id = _profile_id
     AND v.verification_status = 'verified'
   GROUP BY v.community_place_id;
$$;

REVOKE ALL ON FUNCTION public._legit_hosted_meetup_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._legit_place_supports(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_meetup_completions_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_completed_meetup_immutable() FROM PUBLIC;