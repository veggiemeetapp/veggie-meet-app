-- ============================================================
-- WO-037 Phase 1 — Onboarding foundation
-- ============================================================

-- --------- profiles additions ---------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dietary_identity text,
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS community_guidelines_accepted_at timestamptz;

-- validate dietary_identity via trigger (avoids brittle CHECK on time-varying rules)
CREATE OR REPLACE FUNCTION public.validate_profile_dietary_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.dietary_identity IS NOT NULL AND NEW.dietary_identity NOT IN
    ('vegan','vegetarian','plant_based','veg_curious','other') THEN
    RAISE EXCEPTION 'invalid dietary_identity: %', NEW.dietary_identity;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_dietary_identity ON public.profiles;
CREATE TRIGGER trg_profiles_dietary_identity
  BEFORE INSERT OR UPDATE OF dietary_identity ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_dietary_identity();

-- --------- interest_catalogue ---------
CREATE TABLE IF NOT EXISTS public.interest_catalogue (
  id text PRIMARY KEY,
  label text NOT NULL,
  category text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.interest_catalogue TO anon, authenticated;
GRANT ALL ON public.interest_catalogue TO service_role;
ALTER TABLE public.interest_catalogue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "interest_catalogue readable" ON public.interest_catalogue;
CREATE POLICY "interest_catalogue readable" ON public.interest_catalogue
  FOR SELECT USING (true);

INSERT INTO public.interest_catalogue (id, label, category, sort_order) VALUES
  ('coffee',        'Coffee',         'food',      10),
  ('vegan_food',    'Vegan Food',     'food',      20),
  ('cooking',       'Cooking',        'food',      30),
  ('hiking',        'Hiking',         'outdoor',   40),
  ('yoga',          'Yoga',           'wellness',  50),
  ('fitness',       'Fitness',        'wellness',  60),
  ('books',         'Books',          'culture',   70),
  ('live_music',    'Live Music',     'culture',   80),
  ('board_games',   'Board Games',    'social',    90),
  ('travel',        'Travel',         'lifestyle', 100),
  ('volunteering',  'Volunteering',   'community', 110),
  ('sustainability','Sustainability', 'community', 120)
ON CONFLICT (id) DO NOTHING;

-- --------- profile_onboarding_state ---------
CREATE TABLE IF NOT EXISTS public.profile_onboarding_state (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_step text NOT NULL DEFAULT 'welcome',
  completed_steps text[] NOT NULL DEFAULT '{}',
  skipped_steps text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  first_meaningful_action_type text,
  first_meaningful_action_entity_id text,
  first_meaningful_action_at timestamptz,
  onboarding_version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profile_onboarding_state TO authenticated;
GRANT ALL ON public.profile_onboarding_state TO service_role;
ALTER TABLE public.profile_onboarding_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own onboarding state select" ON public.profile_onboarding_state;
CREATE POLICY "own onboarding state select"
  ON public.profile_onboarding_state FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());

DROP POLICY IF EXISTS "own onboarding state insert" ON public.profile_onboarding_state;
CREATE POLICY "own onboarding state insert"
  ON public.profile_onboarding_state FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());

DROP POLICY IF EXISTS "own onboarding state update" ON public.profile_onboarding_state;
CREATE POLICY "own onboarding state update"
  ON public.profile_onboarding_state FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());

CREATE OR REPLACE FUNCTION public.touch_onboarding_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_touch_onboarding_state ON public.profile_onboarding_state;
CREATE TRIGGER trg_touch_onboarding_state
  BEFORE UPDATE ON public.profile_onboarding_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_onboarding_state();

-- --------- analytics_events ---------
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_profile_idx
  ON public.analytics_events (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_idx
  ON public.analytics_events (event_name, created_at DESC);
GRANT INSERT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own analytics insert" ON public.analytics_events;
CREATE POLICY "own analytics insert"
  ON public.analytics_events FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());
-- deliberately no SELECT policy for non-service-role clients

-- Reject payloads containing sensitive keys
CREATE OR REPLACE FUNCTION public.validate_analytics_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE forbidden text[] := ARRAY['bio','email','password','coordinates','latitude','longitude','message','report'];
        k text;
BEGIN
  IF NEW.properties IS NOT NULL THEN
    FOREACH k IN ARRAY forbidden LOOP
      IF NEW.properties ? k THEN
        RAISE EXCEPTION 'analytics payload may not contain %', k;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_analytics_event ON public.analytics_events;
CREATE TRIGGER trg_validate_analytics_event
  BEFORE INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_analytics_event();

-- ============================================================
-- Onboarding RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_onboarding_state()
RETURNS public.profile_onboarding_state
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
  row public.profile_onboarding_state;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '28000';
  END IF;
  SELECT * INTO row FROM public.profile_onboarding_state WHERE profile_id = pid;
  IF NOT FOUND THEN
    INSERT INTO public.profile_onboarding_state (profile_id) VALUES (pid)
    RETURNING * INTO row;
  END IF;
  RETURN row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_onboarding_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_onboarding_step(
  _step text,
  _completed boolean DEFAULT true,
  _skipped boolean DEFAULT false,
  _next_step text DEFAULT NULL
)
RETURNS public.profile_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
  row public.profile_onboarding_state;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  INSERT INTO public.profile_onboarding_state (profile_id, current_step)
  VALUES (pid, COALESCE(_next_step, _step))
  ON CONFLICT (profile_id) DO NOTHING;

  UPDATE public.profile_onboarding_state
  SET
    completed_steps = CASE WHEN _completed AND NOT (_step = ANY(completed_steps))
                           THEN array_append(completed_steps, _step)
                           ELSE completed_steps END,
    skipped_steps   = CASE WHEN _skipped AND NOT (_step = ANY(skipped_steps))
                           THEN array_append(skipped_steps, _step)
                           ELSE skipped_steps END,
    current_step    = COALESCE(_next_step, current_step)
  WHERE profile_id = pid
  RETURNING * INTO row;

  RETURN row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_onboarding_step(text, boolean, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_onboarding()
RETURNS public.profile_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
  prof public.profiles;
  row public.profile_onboarding_state;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = pid;
  IF prof IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;

  IF COALESCE(btrim(prof.display_name),'') = '' THEN
    RAISE EXCEPTION 'display_name required' USING errcode='23514';
  END IF;
  IF prof.dietary_identity IS NULL THEN
    RAISE EXCEPTION 'dietary_identity required' USING errcode='23514';
  END IF;
  IF prof.home_city_id IS NULL THEN
    RAISE EXCEPTION 'home_city required' USING errcode='23514';
  END IF;
  IF array_length(prof.interests, 1) IS NULL OR array_length(prof.interests,1) < 3 THEN
    RAISE EXCEPTION 'minimum 3 interests required' USING errcode='23514';
  END IF;
  IF prof.community_guidelines_accepted_at IS NULL THEN
    RAISE EXCEPTION 'community guidelines acknowledgement required' USING errcode='23514';
  END IF;

  UPDATE public.profiles SET onboarding_completed = true WHERE id = pid;

  INSERT INTO public.profile_onboarding_state (profile_id, current_step, completed_at)
  VALUES (pid, 'done', now())
  ON CONFLICT (profile_id) DO UPDATE
    SET completed_at = COALESCE(public.profile_onboarding_state.completed_at, now()),
        current_step = 'done'
  RETURNING * INTO row;

  RETURN row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_first_meaningful_action(
  _action_type text,
  _entity_id text
)
RETURNS public.profile_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
  row public.profile_onboarding_state;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  INSERT INTO public.profile_onboarding_state (profile_id) VALUES (pid)
  ON CONFLICT (profile_id) DO NOTHING;

  UPDATE public.profile_onboarding_state
  SET first_meaningful_action_type = COALESCE(first_meaningful_action_type, _action_type),
      first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, _entity_id),
      first_meaningful_action_at = COALESCE(first_meaningful_action_at, now())
  WHERE profile_id = pid
  RETURNING * INTO row;

  RETURN row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_first_meaningful_action(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_analytics_event(
  _event_name text,
  _properties jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RETURN; END IF;
  INSERT INTO public.analytics_events (profile_id, event_name, properties)
  VALUES (pid, _event_name, COALESCE(_properties, '{}'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_analytics_event(text, jsonb) TO authenticated;

-- ============================================================
-- Starting-point RPC — ≤1 Veggie, ≤1 Meetup, ≤1 Place
-- Reuses Selected City from get_my_location_context / profile_preferences.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_onboarding_starting_options()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
  sel_city uuid;
  home_city uuid;
  city_id uuid;
  today date := (now() AT TIME ZONE 'utc')::date;
  veggie jsonb;
  meetup jsonb;
  place jsonb;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  SELECT selected_city_id INTO sel_city FROM public.profile_preferences WHERE profile_id = pid;
  SELECT home_city_id INTO home_city FROM public.profiles WHERE id = pid;
  city_id := COALESCE(sel_city, home_city);

  -- Veggie: same city, not self, not blocked either direction, no existing friendship row
  SELECT to_jsonb(v) INTO veggie FROM (
    SELECT p.id AS entity_id,
           'veggie'::text AS entity_type,
           p.display_name AS title,
           p.avatar_url  AS image,
           COALESCE(c.name, p.current_city) AS city,
           'shared_city'::text AS reason_code,
           'In your city' AS reason_label,
           'connect'::text AS action_type
    FROM public.profiles p
    LEFT JOIN public.cities c ON c.id = p.home_city_id
    WHERE p.id <> pid
      AND (city_id IS NULL OR p.home_city_id = city_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_profile_id = pid AND b.blocked_profile_id = p.id)
           OR (b.blocker_profile_id = p.id AND b.blocked_profile_id = pid)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE (f.profile_a_id = pid AND f.profile_b_id = p.id)
           OR (f.profile_a_id = p.id AND f.profile_b_id = pid)
      )
    ORDER BY (p.interests && (SELECT interests FROM public.profiles WHERE id = pid)) DESC NULLS LAST,
             p.updated_at DESC
    LIMIT 1
  ) v;

  -- Meetup: upcoming, not full, not cancelled, in city, host not blocked, known location, not already joined
  SELECT to_jsonb(m) INTO meetup FROM (
    SELECT me.id AS entity_id,
           'meetup'::text AS entity_type,
           me.title AS title,
           me.cover_image_url AS image,
           COALESCE(mc.name, me.city_name_snapshot) AS city,
           'upcoming_in_city'::text AS reason_code,
           'Happening soon in your city' AS reason_label,
           'join'::text AS action_type,
           me.date, me.start_time, me.capacity
    FROM public.meetups me
    LEFT JOIN public.cities mc ON mc.id = me.city_id
    WHERE me.status <> 'cancelled'
      AND me.date >= today
      AND me.location_source <> 'unknown'
      AND me.city_id IS NOT NULL
      AND (city_id IS NULL OR me.city_id = city_id)
      AND me.host_id <> pid
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_profile_id = pid AND b.blocked_profile_id = me.host_id)
           OR (b.blocker_profile_id = me.host_id AND b.blocked_profile_id = pid)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.meetup_id = me.id AND a.profile_id = pid
          AND a.status <> 'cancelled'
      )
      AND (
        SELECT count(*) FROM public.attendance a2
        WHERE a2.meetup_id = me.id AND a2.status NOT IN ('cancelled')
      ) < me.capacity
    ORDER BY me.date ASC, me.start_time ASC
    LIMIT 1
  ) m;

  -- Place: in city if the community_places table has cities; skip if not present
  BEGIN
    SELECT to_jsonb(pl) INTO place FROM (
      SELECT cp.id::text AS entity_id,
             'place'::text AS entity_type,
             cp.name AS title,
             cp.cover_image_url AS image,
             COALESCE(cpc.name, cp.city_name) AS city,
             'in_your_city'::text AS reason_code,
             'A veggie-friendly place in your city' AS reason_label,
             'view'::text AS action_type
      FROM public.community_places cp
      LEFT JOIN public.cities cpc ON cpc.id = cp.city_id
      WHERE (city_id IS NULL OR cp.city_id = city_id)
        AND COALESCE(cp.archived, false) = false
      ORDER BY cp.created_at DESC NULLS LAST
      LIMIT 1
    ) pl;
  EXCEPTION WHEN undefined_column THEN
    place := NULL; -- schema mismatch — fail soft, no place option
  END;

  RETURN jsonb_build_object(
    'veggie', veggie,
    'meetup', meetup,
    'place',  place,
    'selected_city_id', city_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_onboarding_starting_options() TO authenticated;

-- ============================================================
-- Activation triggers — record first meaningful action on
-- backend success. Never overwrites an existing record.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_activation_friendship()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid; other uuid;
BEGIN
  actor := COALESCE(NEW.requester_id, NEW.profile_a_id);
  other := CASE WHEN actor = NEW.profile_a_id THEN NEW.profile_b_id ELSE NEW.profile_a_id END;
  INSERT INTO public.profile_onboarding_state (profile_id) VALUES (actor)
    ON CONFLICT (profile_id) DO NOTHING;
  UPDATE public.profile_onboarding_state
     SET first_meaningful_action_type      = COALESCE(first_meaningful_action_type, 'connection_request_sent'),
         first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, other::text),
         first_meaningful_action_at        = COALESCE(first_meaningful_action_at, now())
   WHERE profile_id = actor;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_activation_friendship ON public.friendships;
CREATE TRIGGER trg_activation_friendship AFTER INSERT ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.trg_activation_friendship();

CREATE OR REPLACE FUNCTION public.trg_activation_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('joined','checked_in','attended') THEN RETURN NEW; END IF;
  INSERT INTO public.profile_onboarding_state (profile_id) VALUES (NEW.profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
  UPDATE public.profile_onboarding_state
     SET first_meaningful_action_type      = COALESCE(first_meaningful_action_type, 'meetup_joined'),
         first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, NEW.meetup_id::text),
         first_meaningful_action_at        = COALESCE(first_meaningful_action_at, now())
   WHERE profile_id = NEW.profile_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_activation_attendance ON public.attendance;
CREATE TRIGGER trg_activation_attendance AFTER INSERT ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.trg_activation_attendance();

CREATE OR REPLACE FUNCTION public.trg_activation_place_checkin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profile_onboarding_state (profile_id) VALUES (NEW.profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
  UPDATE public.profile_onboarding_state
     SET first_meaningful_action_type      = COALESCE(first_meaningful_action_type, 'place_supported'),
         first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, NEW.community_place_id::text),
         first_meaningful_action_at        = COALESCE(first_meaningful_action_at, now())
   WHERE profile_id = NEW.profile_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_activation_place_checkin ON public.place_check_ins;
CREATE TRIGGER trg_activation_place_checkin AFTER INSERT ON public.place_check_ins
  FOR EACH ROW EXECUTE FUNCTION public.trg_activation_place_checkin();

CREATE OR REPLACE FUNCTION public.trg_activation_meetup_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profile_onboarding_state (profile_id) VALUES (NEW.host_id)
    ON CONFLICT (profile_id) DO NOTHING;
  UPDATE public.profile_onboarding_state
     SET first_meaningful_action_type      = COALESCE(first_meaningful_action_type, 'meetup_created'),
         first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, NEW.id::text),
         first_meaningful_action_at        = COALESCE(first_meaningful_action_at, now())
   WHERE profile_id = NEW.host_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_activation_meetup_created ON public.meetups;
CREATE TRIGGER trg_activation_meetup_created AFTER INSERT ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.trg_activation_meetup_created();

CREATE OR REPLACE FUNCTION public.trg_activation_invitation_accepted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM 'accepted') THEN
    INSERT INTO public.profile_onboarding_state (profile_id) VALUES (NEW.recipient_id)
      ON CONFLICT (profile_id) DO NOTHING;
    UPDATE public.profile_onboarding_state
       SET first_meaningful_action_type      = COALESCE(first_meaningful_action_type, 'invitation_accepted'),
           first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, NEW.meetup_id::text),
           first_meaningful_action_at        = COALESCE(first_meaningful_action_at, now())
     WHERE profile_id = NEW.recipient_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_activation_invitation_accepted ON public.meetup_invitations;
CREATE TRIGGER trg_activation_invitation_accepted AFTER UPDATE ON public.meetup_invitations
  FOR EACH ROW EXECUTE FUNCTION public.trg_activation_invitation_accepted();

-- ============================================================
-- Existing-user back-fill
-- ============================================================
INSERT INTO public.profile_onboarding_state (profile_id, current_step, completed_steps, completed_at, onboarding_version)
SELECT p.id,
       'done',
       ARRAY['welcome','identity','dietary','home_city','selected_city','interests','photo','guidelines','safety','starting_point']::text[],
       COALESCE(p.updated_at, now()),
       1
FROM public.profiles p
WHERE p.onboarding_completed = true
ON CONFLICT (profile_id) DO NOTHING;

-- Accept guidelines for existing complete users (silent legacy migration)
UPDATE public.profiles
   SET community_guidelines_accepted_at = COALESCE(community_guidelines_accepted_at, updated_at, now())
 WHERE onboarding_completed = true
   AND community_guidelines_accepted_at IS NULL;
