-- =====================================================================
-- WO-076 — Meetup creation, editing, capacity & invitation integrity
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Canonical timezone-aware event instant helpers.
--    Every lifecycle gate must judge "has started / has ended" in the
--    Meetup's own timezone, never in the server session timezone.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meetup_start_at(_date date, _start_time time without time zone, _timezone text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ((_date::timestamp + _start_time) AT TIME ZONE COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'));
$$;

CREATE OR REPLACE FUNCTION public.meetup_end_at(_date date, _start_time time without time zone, _end_time time without time zone, _timezone text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- end_time before start_time is treated as crossing midnight.
  SELECT ((_date::timestamp + COALESCE(_end_time, _start_time + INTERVAL '2 hours')
           + CASE WHEN _end_time IS NOT NULL AND _end_time < _start_time
                  THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
          AT TIME ZONE COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'));
$$;

REVOKE ALL ON FUNCTION public.meetup_start_at(date, time without time zone, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meetup_end_at(date, time without time zone, time without time zone, text) FROM PUBLIC;

-- Timezone validity check (no exception leaks to the caller).
CREATE OR REPLACE FUNCTION public.is_valid_timezone(_tz text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF _tz IS NULL OR btrim(_tz) = '' THEN RETURN false; END IF;
  PERFORM now() AT TIME ZONE _tz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.is_valid_timezone(text) FROM PUBLIC;

-- Host / participant eligibility: authenticated, existing, not deleted.
CREATE OR REPLACE FUNCTION public.profile_is_eligible(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _profile_id AND p.deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.profile_is_eligible(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------
-- 2. Trusted Meetup creation RPC (replaces the direct client INSERT).
--    Host identity comes from auth only. No client-supplied host_id,
--    status, cancellation, completion or "inferred" flags are accepted.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_hosted_meetup(
  _title text,
  _description text,
  _category text,
  _date date,
  _start_time time without time zone,
  _end_time time without time zone,
  _capacity integer,
  _city_id uuid,
  _community_place_id uuid,
  _location_name text,
  _address text,
  _neighborhood text,
  _latitude double precision,
  _longitude double precision,
  _timezone text,
  _cover_image_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid;
  city RECORD;
  cat public.meetup_category;
  tz text;
  clean_title text;
  clean_desc text;
  clean_loc text;
  clean_addr text;
  new_id uuid;
  starts_at timestamptz;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.profile_is_eligible(me) THEN
    RAISE EXCEPTION 'This account can''t host Meetups.';
  END IF;

  -- Text fields ------------------------------------------------------
  clean_title := btrim(COALESCE(_title, ''));
  IF clean_title = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF char_length(clean_title) > 120 THEN RAISE EXCEPTION 'Title too long'; END IF;
  clean_desc := btrim(COALESCE(_description, ''));
  IF char_length(clean_desc) > 2000 THEN RAISE EXCEPTION 'Description too long'; END IF;

  -- Category ---------------------------------------------------------
  BEGIN
    cat := _category::public.meetup_category;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Choose a valid Meetup type';
  END;

  -- Capacity ---------------------------------------------------------
  IF _capacity IS NULL OR _capacity < 1 OR _capacity > 500 THEN
    RAISE EXCEPTION 'Capacity must be between 1 and 500';
  END IF;

  -- City / timezone --------------------------------------------------
  IF _city_id IS NULL THEN RAISE EXCEPTION 'City is required'; END IF;
  SELECT * INTO city FROM public.cities WHERE id = _city_id AND is_active;
  IF city IS NULL THEN RAISE EXCEPTION 'City unavailable'; END IF;

  tz := NULLIF(btrim(COALESCE(_timezone, '')), '');
  IF tz IS NULL THEN tz := city.timezone; END IF;
  IF NOT public.is_valid_timezone(tz) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;

  -- Times (judged in the Meetup's own timezone) -----------------------
  IF _date IS NULL OR _start_time IS NULL OR _end_time IS NULL THEN
    RAISE EXCEPTION 'Date, start time and end time are required';
  END IF;
  IF _end_time <= _start_time THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  starts_at := public.meetup_start_at(_date, _start_time, tz);
  IF starts_at < now() THEN
    RAISE EXCEPTION 'Date and time must be in the future';
  END IF;
  IF starts_at > now() + INTERVAL '1 year' THEN
    RAISE EXCEPTION 'Meetups can only be scheduled up to a year ahead';
  END IF;

  -- Location ---------------------------------------------------------
  clean_loc  := NULLIF(btrim(COALESCE(_location_name, '')), '');
  clean_addr := NULLIF(btrim(COALESCE(_address, '')), '');
  IF _community_place_id IS NULL THEN
    -- Free-text location: name and address required, coordinates optional.
    IF clean_loc IS NULL THEN RAISE EXCEPTION 'A location name is required.'; END IF;
    IF char_length(clean_loc) > 200 THEN RAISE EXCEPTION 'Location name too long'; END IF;
    IF clean_addr IS NULL THEN RAISE EXCEPTION 'An address is required.'; END IF;
    IF char_length(clean_addr) > 300 THEN RAISE EXCEPTION 'Address too long'; END IF;
    IF (_latitude IS NULL) <> (_longitude IS NULL) THEN
      RAISE EXCEPTION 'Latitude and longitude must both be provided or both omitted';
    END IF;
    IF _latitude IS NOT NULL
       AND (_latitude NOT BETWEEN -90 AND 90 OR _longitude NOT BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'Invalid coordinates';
    END IF;
  END IF;
  -- Community Place eligibility + snapshot is enforced authoritatively by
  -- zz_enforce_meetup_community_place (WO-062); coordinates are never taken
  -- from the client for place-backed Meetups (WO-061A).

  IF _cover_image_url IS NOT NULL AND char_length(_cover_image_url) > 500000 THEN
    RAISE EXCEPTION 'Cover image is too large';
  END IF;

  INSERT INTO public.meetups (
    title, description, category, host_id,
    community_place_id, custom_location_name, custom_location_address,
    cover_image_url, date, start_time, end_time, capacity, status,
    city_id, city_name_snapshot, country_code_snapshot, timezone,
    neighborhood, location_name, address, latitude, longitude,
    location_source, location_is_inferred, location_updated_at
  ) VALUES (
    clean_title, clean_desc, cat, me,
    _community_place_id,
    CASE WHEN _community_place_id IS NULL THEN clean_loc END,
    CASE WHEN _community_place_id IS NULL THEN clean_addr END,
    NULLIF(btrim(COALESCE(_cover_image_url, '')), ''),
    _date, _start_time, _end_time, _capacity, 'upcoming'::public.meetup_status,
    city.id, city.name, city.country_code, tz,
    NULLIF(btrim(COALESCE(_neighborhood, '')), ''),
    COALESCE(clean_loc, ''), clean_addr,
    CASE WHEN _community_place_id IS NULL THEN _latitude END,
    CASE WHEN _community_place_id IS NULL THEN _longitude END,
    CASE WHEN _community_place_id IS NOT NULL
         THEN 'community_place'::public.location_source
         ELSE 'custom_location'::public.location_source END,
    false, now()
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_hosted_meetup(text, text, text, date, time without time zone, time without time zone, integer, uuid, uuid, text, text, text, double precision, double precision, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hosted_meetup(text, text, text, date, time without time zone, time without time zone, integer, uuid, uuid, text, text, text, double precision, double precision, text, text) TO authenticated;

-- ---------------------------------------------------------------
-- 3. Members lose the direct INSERT path. RPC-only creation.
-- ---------------------------------------------------------------
REVOKE INSERT ON public.meetups FROM authenticated;
REVOKE INSERT ON public.meetups FROM anon;

DROP POLICY IF EXISTS "Authenticated users can host meetups" ON public.meetups;
DROP POLICY IF EXISTS "Hosts can update their meetups" ON public.meetups;
DROP POLICY IF EXISTS "Hosts can delete their meetups" ON public.meetups;

-- Invitation writes are RPC-only (no grants); drop the superseded policies.
DROP POLICY IF EXISTS "meetup_invitations_sender_insert" ON public.meetup_invitations;
DROP POLICY IF EXISTS "meetup_invitations_recipient_update" ON public.meetup_invitations;

-- ---------------------------------------------------------------
-- 4. Editing: reject invalid windows and out-of-range capacity, and
--    judge the future-time rule in the Meetup's own timezone.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_hosted_meetup(
  _meetup_id uuid, _title text, _description text, _date date,
  _start_time time without time zone, _end_time time without time zone,
  _capacity integer, _community_place_id uuid, _custom_location_name text,
  _custom_location_address text, _cover_image_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; m RECORD; active_count int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already been cancelled.';
  END IF;
  IF m.status IN ('past'::meetup_status,'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;
  -- Timezone-aware lifecycle lock: an ended/started Meetup is not editable
  -- even if the persisted status column has not caught up yet.
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) <= now() THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;

  IF _title IS NULL OR btrim(_title) = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF char_length(_title) > 120 THEN RAISE EXCEPTION 'Title too long'; END IF;
  IF _description IS NOT NULL AND char_length(_description) > 2000 THEN
    RAISE EXCEPTION 'Description too long';
  END IF;
  IF _capacity IS NULL OR _capacity < 1 OR _capacity > 500 THEN
    RAISE EXCEPTION 'Capacity must be between 1 and 500';
  END IF;
  IF _date IS NULL OR _start_time IS NULL OR _end_time IS NULL THEN
    RAISE EXCEPTION 'Date, start time and end time are required';
  END IF;
  IF _end_time <= _start_time THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  IF public.meetup_start_at(_date, _start_time, m.timezone) < now() THEN
    RAISE EXCEPTION 'Date and time must be in the future';
  END IF;

  SELECT count(*) INTO active_count FROM public.attendance
    WHERE meetup_id = _meetup_id AND status::text NOT IN ('cancelled','removed');
  IF _capacity < active_count THEN
    RAISE EXCEPTION 'Capacity can''t be lower than the number of people already attending.';
  END IF;

  UPDATE public.meetups SET
    title = btrim(_title),
    description = btrim(COALESCE(_description, '')),
    date = _date,
    start_time = _start_time,
    end_time = _end_time,
    capacity = _capacity,
    community_place_id = _community_place_id,
    custom_location_name = _custom_location_name,
    custom_location_address = _custom_location_address,
    cover_image_url = COALESCE(_cover_image_url, cover_image_url),
    updated_at = now()
  WHERE id = _meetup_id;
END;
$$;

-- ---------------------------------------------------------------
-- 5. Join: deletion-aware, timezone-aware (capacity race handling via
--    the existing FOR UPDATE row lock on the Meetup is unchanged).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_meetup(_meetup_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid; existing_id uuid; new_id uuid; prior_status text; m RECORD; active_count int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.profile_is_eligible(me) THEN
    RAISE EXCEPTION 'This account can''t join Meetups.';
  END IF;

  SELECT id INTO existing_id FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
      AND status::text NOT IN ('cancelled','removed') LIMIT 1;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  SELECT status::text INTO prior_status FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
    ORDER BY updated_at DESC LIMIT 1;
  IF prior_status = 'removed' THEN
    RAISE EXCEPTION 'You can''t rejoin this Meetup.';
  END IF;

  -- Row lock serialises concurrent last-seat joins.
  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;

  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  IF m.host_id <> me THEN
    IF NOT public.profile_is_eligible(m.host_id) THEN
      RAISE EXCEPTION 'This Meetup isn''t available to join.';
    END IF;
    IF public.is_blocked_between(me, m.host_id) THEN
      RAISE EXCEPTION 'This Meetup isn''t available to join.';
    END IF;
  END IF;

  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has been cancelled.';
  END IF;
  IF m.status IN ('past'::meetup_status, 'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) < now() THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;

  IF m.host_id <> me THEN
    SELECT count(*) INTO active_count FROM public.attendance a
      WHERE a.meetup_id = _meetup_id AND a.status::text NOT IN ('cancelled','removed');
    IF active_count >= m.capacity THEN
      RAISE EXCEPTION 'This Meetup is full.';
    END IF;
  END IF;

  UPDATE public.attendance
     SET status = 'joined'::attendance_status, joined_at = now()
   WHERE profile_id = me AND meetup_id = _meetup_id AND status = 'cancelled'::attendance_status
   RETURNING id INTO new_id;
  IF new_id IS NOT NULL THEN RETURN new_id; END IF;

  INSERT INTO public.attendance (profile_id, meetup_id, status)
    VALUES (me, _meetup_id, 'joined'::attendance_status)
    RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- ---------------------------------------------------------------
-- 6. Attendance guard: timezone-aware start check.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_meetup_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  active_count int;
  was_active boolean := false;
  will_be_active boolean;
  identity_changed boolean := false;
BEGIN
  will_be_active := NEW.status::text NOT IN ('cancelled','removed');

  IF TG_OP = 'UPDATE' THEN
    was_active := OLD.status::text NOT IN ('cancelled','removed');
    identity_changed := (OLD.profile_id <> NEW.profile_id) OR (OLD.meetup_id <> NEW.meetup_id);
    IF identity_changed THEN
      RAISE EXCEPTION 'Cannot change profile or meetup on attendance';
    END IF;
  END IF;

  IF NOT will_be_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND was_active THEN RETURN NEW; END IF;

  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = NEW.meetup_id FOR UPDATE;

  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup is no longer accepting attendees';
  END IF;
  IF m.status IN ('past'::meetup_status,'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started';
  END IF;
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) < now() THEN
    RAISE EXCEPTION 'This Meetup has already started';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.profile_id = NEW.profile_id AND a.meetup_id = NEW.meetup_id
      AND a.status::text NOT IN ('cancelled','removed')
      AND (TG_OP = 'INSERT' OR a.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'You are already attending this Meetup';
  END IF;

  IF m.host_id = NEW.profile_id THEN RETURN NEW; END IF;

  SELECT count(*) INTO active_count FROM public.attendance a
    WHERE a.meetup_id = NEW.meetup_id
      AND a.status::text NOT IN ('cancelled','removed')
      AND (TG_OP = 'INSERT' OR a.id <> NEW.id);

  IF active_count >= m.capacity THEN
    RAISE EXCEPTION 'This Meetup is full';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------
-- 7. Invitations: deletion-aware + timezone-aware.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_meetup_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m RECORD; conv RECORD; attending_recipient boolean; attendee_count int; sender_attending boolean;
BEGIN
  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = NEW.meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status <> 'upcoming' THEN
    RAISE EXCEPTION 'Meetup is no longer accepting invitations';
  END IF;
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) < now() THEN
    RAISE EXCEPTION 'Meetup has already started';
  END IF;

  IF NOT public.profile_is_eligible(NEW.sender_id)
     OR NOT public.profile_is_eligible(NEW.recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;

  IF m.host_id = NEW.sender_id THEN
    sender_attending := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.attendance
      WHERE profile_id = NEW.sender_id AND meetup_id = NEW.meetup_id
        AND status::text NOT IN ('cancelled','removed')
    ) INTO sender_attending;
  END IF;
  IF NOT sender_attending THEN
    RAISE EXCEPTION 'You must be hosting or attending this Meetup to invite';
  END IF;

  IF NOT public.are_connected(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'You can only invite connected Veggies';
  END IF;
  IF public.is_blocked_between(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = NEW.recipient_id AND meetup_id = NEW.meetup_id
      AND status::text NOT IN ('cancelled','removed')
  ) INTO attending_recipient;
  IF attending_recipient THEN
    RAISE EXCEPTION 'Recipient is already attending';
  END IF;

  SELECT count(*) INTO attendee_count FROM public.attendance
    WHERE meetup_id = NEW.meetup_id AND status::text NOT IN ('cancelled','removed');
  IF attendee_count >= m.capacity THEN
    RAISE EXCEPTION 'Meetup is full';
  END IF;

  SELECT user_a_id, user_b_id INTO conv FROM public.dm_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF NOT ((conv.user_a_id = NEW.sender_id AND conv.user_b_id = NEW.recipient_id)
       OR (conv.user_a_id = NEW.recipient_id AND conv.user_b_id = NEW.sender_id)) THEN
    RAISE EXCEPTION 'Conversation does not match sender/recipient';
  END IF;

  RETURN NEW;
END;
$$;

-- Invitation acceptance re-checks current eligibility (never trusts the
-- invitation itself as standing proof).
CREATE OR REPLACE FUNCTION public.join_from_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; inv RECORD; m_status meetup_status;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO inv FROM public.meetup_invitations WHERE id = _invitation_id;
  IF inv IS NULL OR inv.recipient_id <> me THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF inv.status = 'declined'::invitation_status THEN
    RAISE EXCEPTION 'Invitation no longer available';
  END IF;

  IF NOT public.profile_is_eligible(inv.sender_id)
     OR NOT public.profile_is_eligible(inv.recipient_id) THEN
    RAISE EXCEPTION 'Invitation no longer available';
  END IF;

  IF public.is_blocked_between(inv.sender_id, inv.recipient_id) THEN
    RAISE EXCEPTION 'Invitation no longer available';
  END IF;

  SELECT status INTO m_status FROM public.meetups WHERE id = inv.meetup_id;
  IF m_status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has been cancelled.';
  END IF;

  -- Capacity, start time and block rules are re-enforced here.
  PERFORM public.join_meetup(inv.meetup_id);

  UPDATE public.meetup_invitations
     SET status = 'joined',
         joined_at = COALESCE(joined_at, now()),
         viewed_at = COALESCE(viewed_at, now())
   WHERE id = _invitation_id;
END;
$$;

-- Invitation creation: reject deleted recipients up front.
CREATE OR REPLACE FUNCTION public.create_meetup_invitation(_meetup_id uuid, _recipient_id uuid, _personal_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; conv_id uuid; invitation_id uuid; existing_id uuid; clean_msg text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _recipient_id = me THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF NOT public.profile_is_eligible(me) OR NOT public.profile_is_eligible(_recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;
  IF public.is_blocked_between(me, _recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;

  clean_msg := COALESCE(btrim(_personal_message), '');
  IF char_length(clean_msg) > 300 THEN RAISE EXCEPTION 'Message too long'; END IF;
  IF clean_msg = '' THEN clean_msg := 'Want to join me for this Meetup?'; END IF;

  SELECT id INTO existing_id FROM public.meetup_invitations
    WHERE meetup_id = _meetup_id AND sender_id = me AND recipient_id = _recipient_id;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'You already invited this Veggie to this Meetup';
  END IF;

  conv_id := public.get_or_create_dm(_recipient_id);

  INSERT INTO public.meetup_invitations
    (meetup_id, sender_id, recipient_id, conversation_id, personal_message)
  VALUES (_meetup_id, me, _recipient_id, conv_id, clean_msg)
  RETURNING id INTO invitation_id;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body, invitation_id)
  VALUES (conv_id, me, clean_msg, invitation_id);

  RETURN invitation_id;
END;
$$;

-- ---------------------------------------------------------------
-- 8. Location change: timezone-aware "already ended" gate.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_meetup_location(
  _meetup_id uuid, _city_id uuid, _community_place_id uuid, _location_name text,
  _address text, _neighborhood text, _latitude double precision,
  _longitude double precision, _timezone text, _location_source location_source)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid; m RECORD; city RECORD; place RECORD;
  meaningful boolean := false; notify_worthy boolean := false;
  coord_shift_m double precision := 0;
  change_id uuid; v_dedup text;
  recipients_ct int := 0; inserted_ct int := 0;
  old_mode text; new_mode text;
  new_place_name text; v_title text; v_body text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN RAISE EXCEPTION 'This Meetup has already been cancelled.'; END IF;
  IF public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) <= now() THEN
    RAISE EXCEPTION 'This Meetup has already ended.';
  END IF;
  IF _city_id IS NULL THEN RAISE EXCEPTION 'City is required'; END IF;
  SELECT * INTO city FROM public.cities WHERE id = _city_id AND is_active;
  IF city IS NULL THEN RAISE EXCEPTION 'City unavailable'; END IF;

  IF _community_place_id IS NOT NULL THEN
    SELECT * INTO place FROM public.community_places
     WHERE id = _community_place_id
       AND is_active
       AND verification_status = 'verified'
       AND COALESCE(maintenance_status, 'operational') = 'operational';
    IF place IS NULL THEN
      RAISE EXCEPTION 'That place is not available for hosting.';
    END IF;
  ELSIF _location_name IS NULL OR btrim(_location_name) = '' THEN
    RAISE EXCEPTION 'A location name is required.';
  END IF;

  IF (_latitude IS NULL) <> (_longitude IS NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must both be provided or both omitted';
  END IF;
  IF _latitude IS NOT NULL AND (_latitude NOT BETWEEN -90 AND 90 OR _longitude NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;
  IF _timezone IS NULL OR btrim(_timezone) = '' THEN _timezone := city.timezone; END IF;
  IF NOT public.is_valid_timezone(_timezone) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;

  IF _latitude IS NOT NULL AND m.latitude IS NOT NULL THEN
    coord_shift_m := 2 * 6371000 * asin(sqrt(
      power(sin(radians((_latitude - m.latitude)/2)), 2) +
      cos(radians(m.latitude)) * cos(radians(_latitude)) *
      power(sin(radians((_longitude - m.longitude)/2)), 2)));
  END IF;

  old_mode := CASE WHEN m.community_place_id IS NOT NULL THEN 'community_place' ELSE 'custom' END;
  new_mode := CASE WHEN _community_place_id IS NOT NULL THEN 'community_place' ELSE 'custom' END;

  meaningful := (
    COALESCE(m.city_id::text,'') IS DISTINCT FROM COALESCE(_city_id::text,'') OR
    COALESCE(m.community_place_id::text,'') IS DISTINCT FROM COALESCE(_community_place_id::text,'') OR
    COALESCE(lower(btrim(m.location_name)),'') IS DISTINCT FROM COALESCE(lower(btrim(_location_name)),'') OR
    COALESCE(lower(btrim(m.address)),'') IS DISTINCT FROM COALESCE(lower(btrim(_address)),'') OR
    COALESCE(m.timezone,'') IS DISTINCT FROM COALESCE(_timezone,'') OR
    coord_shift_m > 500);

  notify_worthy := (
    old_mode IS DISTINCT FROM new_mode OR
    COALESCE(m.community_place_id::text,'') IS DISTINCT FROM COALESCE(_community_place_id::text,'') OR
    (new_mode = 'custom' AND (
      COALESCE(lower(btrim(m.location_name)),'') IS DISTINCT FROM COALESCE(lower(btrim(_location_name)),'') OR
      COALESCE(lower(btrim(m.address)),'') IS DISTINCT FROM COALESCE(lower(btrim(_address)),'')
    )));

  INSERT INTO public.meetup_location_changes (meetup_id, changed_by_profile_id,
    old_city_id, new_city_id, old_location_name, new_location_name,
    old_address, new_address, old_latitude, old_longitude, new_latitude, new_longitude,
    old_timezone, new_timezone, meaningful_change,
    old_community_place_id, new_community_place_id, old_location_mode, new_location_mode)
  VALUES (_meetup_id, me, m.city_id, _city_id, m.location_name, _location_name,
    m.address, _address, m.latitude, m.longitude, _latitude, _longitude,
    m.timezone, _timezone, meaningful,
    m.community_place_id, _community_place_id, old_mode, new_mode)
  RETURNING id INTO change_id;

  UPDATE public.meetups SET
    city_id=_city_id, city_name_snapshot=city.name, country_code_snapshot=city.country_code,
    timezone=_timezone, neighborhood=_neighborhood, location_name=_location_name,
    address=_address, latitude=_latitude, longitude=_longitude,
    community_place_id=_community_place_id,
    location_source=COALESCE(_location_source, m.location_source),
    location_is_inferred=false, location_updated_at=now(), updated_at=now()
  WHERE id=_meetup_id;

  IF notify_worthy THEN
    IF _community_place_id IS NOT NULL THEN
      SELECT cp.name INTO new_place_name FROM public.community_places cp WHERE cp.id = _community_place_id;
    END IF;

    v_title := 'Meetup location changed';
    v_body := CASE
      WHEN new_mode = 'community_place' AND new_place_name IS NOT NULL THEN
        COALESCE(m.title,'A Meetup') || ' is now happening at ' || new_place_name || '.'
      WHEN new_mode = 'custom' AND old_mode = 'community_place' THEN
        COALESCE(m.title,'A Meetup') || ' now has a new custom location.'
      ELSE
        'The location for ' || COALESCE(m.title,'a Meetup') || ' has been updated.'
    END;

    v_dedup := 'meetup_location_changed:' || _meetup_id::text || ':' || change_id::text;

    WITH eligible_recipients AS (
      SELECT DISTINCT a.profile_id
        FROM public.attendance a
       WHERE a.meetup_id = _meetup_id
         AND a.profile_id IS NOT NULL
         AND a.profile_id <> me
         AND a.status::text NOT IN ('cancelled','removed')
         AND public.profile_is_eligible(a.profile_id)
         AND NOT public.is_blocked_between(me, a.profile_id)
    ),
    counted AS (SELECT count(*) AS n FROM eligible_recipients),
    inserted AS (
      INSERT INTO public.notifications (
        recipient_id, actor_id, type, entity_type, entity_id,
        destination_type, destination_id, title, body, metadata, dedup_key)
      SELECT er.profile_id, me, 'meetup_location_changed'::notification_type,
        'meetup', _meetup_id, 'meetup', _meetup_id,
        v_title, v_body,
        jsonb_build_object(
          'meetup_id', _meetup_id,
          'change_id', change_id,
          'old_location_mode', old_mode,
          'new_location_mode', new_mode,
          'new_place_name', new_place_name),
        v_dedup
      FROM eligible_recipients er
      WHERE COALESCE((SELECT np.meetup_updates FROM public.notification_preferences np
                       WHERE np.profile_id = er.profile_id), TRUE)
      ON CONFLICT (recipient_id, dedup_key) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT n FROM counted), (SELECT count(*) FROM inserted)
      INTO recipients_ct, inserted_ct;

    INSERT INTO public.analytics_events (profile_id, event_name, properties)
    VALUES (me, 'meetup_location_change_notification_created',
      jsonb_build_object('meetup_id', _meetup_id, 'recipient_count', inserted_ct,
                         'new_location_mode', new_mode));
  END IF;

  RETURN jsonb_build_object(
    'meetup_id', _meetup_id, 'change_id', change_id,
    'meaningful_change', meaningful, 'notified', notify_worthy,
    'coord_shift_m', coord_shift_m,
    'recipients_count', recipients_ct, 'notifications_inserted', inserted_ct
  );
END;
$$;

-- ---------------------------------------------------------------
-- 9. Indexes for the hot lifecycle paths.
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attendance_meetup_status
  ON public.attendance (meetup_id, status);
CREATE INDEX IF NOT EXISTS idx_meetups_host_date
  ON public.meetups (host_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meetups_status_date
  ON public.meetups (status, date);
CREATE INDEX IF NOT EXISTS idx_invitations_recipient_status
  ON public.meetup_invitations (recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_meetup_sender
  ON public.meetup_invitations (meetup_id, sender_id);
