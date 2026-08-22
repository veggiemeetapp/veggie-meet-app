-- WO-126 — canonical interest taxonomy becomes the single host-facing Meetup
-- classification. The legacy `meetups.category` enum column is retained as an
-- invisible compatibility detail and is now DERIVED deterministically from the
-- Meetup's Primary canonical interest instead of a separate host choice.

CREATE OR REPLACE FUNCTION public.legacy_meetup_category_for_interest(_interest_id text)
RETURNS public.meetup_category
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- Explicit, deterministic id-to-enum map. No display-label matching.
  -- Canonical interests with no accurate legacy equivalent resolve to the
  -- enum's residual member 'other' (the enum is NOT NULL); this is a
  -- compatibility value only and is never shown to hosts or members.
  SELECT CASE _interest_id
    WHEN 'coffee'             THEN 'coffee'
    WHEN 'cooking'            THEN 'cooking'
    WHEN 'dining_out'         THEN 'dinner'
    WHEN 'picnics'            THEN 'picnic'
    WHEN 'hiking'             THEN 'walk'
    WHEN 'walking'            THEN 'walk'
    WHEN 'workshops_learning' THEN 'workshop'
    ELSE 'other'
  END::public.meetup_category
$$;

REVOKE ALL ON FUNCTION public.legacy_meetup_category_for_interest(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legacy_meetup_category_for_interest(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_hosted_meetup(_title text, _description text, _category text, _date date, _start_time time without time zone, _end_time time without time zone, _capacity integer, _city_id uuid, _community_place_id uuid, _location_name text, _address text, _neighborhood text, _latitude double precision, _longitude double precision, _timezone text, _cover_image_url text, _primary_interest_id text DEFAULT NULL::text, _additional_interest_ids text[] DEFAULT '{}'::text[])
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
  primary_id text;
  additional_ids text[];
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.profile_is_eligible(me) THEN
    RAISE EXCEPTION 'This account can''t host Meetups.';
  END IF;

  clean_title := btrim(COALESCE(_title, ''));
  IF clean_title = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF char_length(clean_title) > 120 THEN RAISE EXCEPTION 'Title too long'; END IF;
  clean_desc := btrim(COALESCE(_description, ''));
  IF char_length(clean_desc) > 2000 THEN RAISE EXCEPTION 'Description too long'; END IF;

  primary_id := public.resolve_interest_id(_primary_interest_id);
  IF primary_id IS NULL THEN
    RAISE EXCEPTION 'Choose a main category for this Meetup' USING ERRCODE = '22023';
  END IF;
  additional_ids := ARRAY(
    SELECT x FROM unnest(public.canonical_interest_ids(_additional_interest_ids)) x
    WHERE x <> primary_id
  );
  IF array_length(additional_ids, 1) > 2 THEN
    RAISE EXCEPTION 'Pick at most 2 additional categories' USING ERRCODE = '22023';
  END IF;

  -- WO-126: legacy compatibility value, derived from the canonical Primary
  -- category. `_category` is accepted for wire compatibility with older
  -- clients but is intentionally ignored.
  cat := public.legacy_meetup_category_for_interest(primary_id);

  IF _capacity IS NULL OR _capacity < 1 OR _capacity > 500 THEN
    RAISE EXCEPTION 'Capacity must be between 1 and 500';
  END IF;

  IF _city_id IS NULL THEN RAISE EXCEPTION 'City is required'; END IF;
  SELECT * INTO city FROM public.cities WHERE id = _city_id AND is_active;
  IF city IS NULL THEN RAISE EXCEPTION 'City unavailable'; END IF;

  tz := NULLIF(btrim(COALESCE(_timezone, '')), '');
  IF tz IS NULL THEN tz := city.timezone; END IF;
  IF NOT public.is_valid_timezone(tz) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;

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
    location_source, location_is_inferred, location_updated_at,
    primary_interest_id, additional_interest_ids
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
    false, now(),
    primary_id, COALESCE(additional_ids, '{}'::text[])
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;