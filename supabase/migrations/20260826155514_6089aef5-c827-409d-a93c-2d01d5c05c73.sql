DROP FUNCTION IF EXISTS public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text,text,text[]);

CREATE OR REPLACE FUNCTION public.update_hosted_meetup(
  _meetup_id uuid,
  _title text,
  _description text,
  _date date,
  _start_time time without time zone,
  _end_time time without time zone,
  _capacity integer,
  _community_place_id uuid,
  _custom_location_name text,
  _custom_location_address text,
  _cover_image_url text,
  _primary_interest_id text DEFAULT NULL::text,
  _additional_interest_ids text[] DEFAULT NULL::text[],
  _clear_cover boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; m RECORD; active_count int;
  primary_id text; additional_ids text[];
  next_cover text;
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

  IF _primary_interest_id IS NOT NULL THEN
    primary_id := public.resolve_interest_id(_primary_interest_id);
    IF primary_id IS NULL THEN
      RAISE EXCEPTION 'Choose what this Meetup is about' USING ERRCODE = '22023';
    END IF;
    additional_ids := ARRAY(
      SELECT x FROM unnest(public.canonical_interest_ids(COALESCE(_additional_interest_ids, '{}'::text[]))) x
      WHERE x <> primary_id
    );
    IF array_length(additional_ids, 1) > 2 THEN
      RAISE EXCEPTION 'Pick at most 2 additional interests' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- WO-133: cover editing. `_clear_cover` is the only way to reach the
  -- canonical no-cover value (NULL); a NULL `_cover_image_url` still means
  -- "leave the current cover untouched". A replacement is validated with the
  -- exact same rules as creation (WO-131B) before it is written, so a rejected
  -- payload leaves the published cover intact.
  IF _clear_cover THEN
    next_cover := NULL;
  ELSIF _cover_image_url IS NULL THEN
    next_cover := m.cover_image_url;
  ELSE
    IF char_length(_cover_image_url) > 500000 THEN
      RAISE EXCEPTION 'Cover image is too large' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_allowed_meetup_cover(_cover_image_url) THEN
      RAISE EXCEPTION 'That cover photo format isn''t supported. Use a JPG, PNG, or WebP photo.'
        USING ERRCODE = '22023';
    END IF;
    next_cover := _cover_image_url;
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
    cover_image_url = next_cover,
    primary_interest_id = COALESCE(primary_id, primary_interest_id),
    additional_interest_ids = CASE WHEN primary_id IS NOT NULL
                                   THEN COALESCE(additional_ids, '{}'::text[])
                                   ELSE additional_interest_ids END,
    category = CASE WHEN primary_id IS NOT NULL
                    THEN public.legacy_meetup_category_for_interest(primary_id)
                    ELSE category END,
    updated_at = now()
  WHERE id = _meetup_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text,text,text[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text,text,text[],boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text,text,text[],boolean) TO service_role;