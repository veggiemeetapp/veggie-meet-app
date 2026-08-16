-- WO-112: optional Meetup end time -------------------------------------------
-- The whole lifecycle layer (meetup_end_at, meetup_has_ended,
-- meetup_in_check_in_window, complete_hosted_meetup, plans/today/search) already
-- treats end_time as nullable via COALESCE(end_time, start_time + 2h), so only
-- the column nullability, the integrity CHECK and the two authoritative RPCs
-- need to change.

ALTER TABLE public.meetups ALTER COLUMN end_time DROP NOT NULL;

ALTER TABLE public.meetups
  DROP CONSTRAINT IF EXISTS meetups_end_after_start;
ALTER TABLE public.meetups
  ADD CONSTRAINT meetups_end_after_start
  CHECK (end_time IS NULL OR end_time > start_time);

CREATE OR REPLACE FUNCTION public.create_hosted_meetup(_title text, _description text, _category text, _date date, _start_time time without time zone, _end_time time without time zone, _capacity integer, _city_id uuid, _community_place_id uuid, _location_name text, _address text, _neighborhood text, _latitude double precision, _longitude double precision, _timezone text, _cover_image_url text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- WO-112: end time is optional. NULL means "no specified ending time".
  IF _date IS NULL OR _start_time IS NULL THEN
    RAISE EXCEPTION 'Date and start time are required';
  END IF;
  IF _end_time IS NOT NULL AND _end_time <= _start_time THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.update_hosted_meetup(_meetup_id uuid, _title text, _description text, _date date, _start_time time without time zone, _end_time time without time zone, _capacity integer, _community_place_id uuid, _custom_location_name text, _custom_location_address text, _cover_image_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- WO-112: NULL _end_time clears any existing end time.
  IF _date IS NULL OR _start_time IS NULL THEN
    RAISE EXCEPTION 'Date and start time are required';
  END IF;
  IF _end_time IS NOT NULL AND _end_time <= _start_time THEN
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
$function$;