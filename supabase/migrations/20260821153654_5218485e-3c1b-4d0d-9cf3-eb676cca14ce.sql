-- WO-124 — Shared interest taxonomy, profile interest editing, meetup interest
-- tagging and recommendation wiring.

ALTER TABLE public.interest_catalogue
  ADD COLUMN IF NOT EXISTS group_key  text,
  ADD COLUMN IF NOT EXISTS group_label text,
  ADD COLUMN IF NOT EXISTS group_sort  integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.interest_migration_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid,
  entity      text NOT NULL,
  legacy_value text NOT NULL,
  action      text NOT NULL,
  new_value   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.interest_migration_log TO service_role;
ALTER TABLE public.interest_migration_log ENABLE ROW LEVEL SECURITY;

WITH t(id, label, group_key, group_label, group_sort, sort_order) AS (
  VALUES
    ('vegan_food',        'Vegan Food',            'food_drink','Food & Drink',1,1),
    ('dining_out',        'Dining Out',            'food_drink','Food & Drink',1,2),
    ('coffee',            'Coffee',                'food_drink','Food & Drink',1,3),
    ('tea',               'Tea',                   'food_drink','Food & Drink',1,4),
    ('cooking',           'Cooking',               'food_drink','Food & Drink',1,5),
    ('baking',            'Baking',                'food_drink','Food & Drink',1,6),
    ('street_food',       'Street Food',           'food_drink','Food & Drink',1,7),
    ('plant_nutrition',   'Plant-Based Nutrition', 'food_drink','Food & Drink',1,8),
    ('yoga',              'Yoga',                  'movement_wellness','Movement & Wellness',2,1),
    ('fitness',           'Fitness',               'movement_wellness','Movement & Wellness',2,2),
    ('running',           'Running',               'movement_wellness','Movement & Wellness',2,3),
    ('cycling',           'Cycling',               'movement_wellness','Movement & Wellness',2,4),
    ('hiking',            'Hiking',                'movement_wellness','Movement & Wellness',2,5),
    ('walking',           'Walking',               'movement_wellness','Movement & Wellness',2,6),
    ('meditation',        'Meditation',            'movement_wellness','Movement & Wellness',2,7),
    ('parks_picnics',     'Parks & Picnics',       'outdoors_nature','Outdoors & Nature',3,1),
    ('gardening',         'Gardening',             'outdoors_nature','Outdoors & Nature',3,2),
    ('beaches',           'Beaches',               'outdoors_nature','Outdoors & Nature',3,3),
    ('camping',           'Camping',               'outdoors_nature','Outdoors & Nature',3,4),
    ('travel',            'Travel',                'outdoors_nature','Outdoors & Nature',3,5),
    ('animal_welfare',    'Animal Welfare',        'outdoors_nature','Outdoors & Nature',3,6),
    ('live_music',        'Live Music',            'arts_culture','Arts & Culture',4,1),
    ('art_museums',       'Art & Museums',         'arts_culture','Arts & Culture',4,2),
    ('films',             'Films',                 'arts_culture','Arts & Culture',4,3),
    ('reading',           'Reading',               'arts_culture','Arts & Culture',4,4),
    ('photography',       'Photography',           'arts_culture','Arts & Culture',4,5),
    ('crafts_diy',        'Crafts & DIY',          'arts_culture','Arts & Culture',4,6),
    ('workshops',         'Workshops',             'learning_making','Learning & Making',5,1),
    ('languages',         'Languages',             'learning_making','Learning & Making',5,2),
    ('tech',              'Tech',                  'learning_making','Learning & Making',5,3),
    ('board_games',       'Board Games',           'learning_making','Learning & Making',5,4),
    ('writing',           'Writing',               'learning_making','Learning & Making',5,5),
    ('volunteering',      'Volunteering',          'community_purpose','Community & Purpose',6,1),
    ('sustainability',    'Sustainability',        'community_purpose','Community & Purpose',6,2),
    ('activism',          'Activism',              'community_purpose','Community & Purpose',6,3)
)
INSERT INTO public.interest_catalogue (id, label, category, group_key, group_label, group_sort, sort_order, active)
SELECT id, label, group_key, group_key, group_label, group_sort, sort_order, true FROM t
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      category    = EXCLUDED.category,
      group_key   = EXCLUDED.group_key,
      group_label = EXCLUDED.group_label,
      group_sort  = EXCLUDED.group_sort,
      sort_order  = EXCLUDED.sort_order,
      active      = true;

UPDATE public.interest_catalogue SET active = false
WHERE id NOT IN (
  'vegan_food','dining_out','coffee','tea','cooking','baking','street_food','plant_nutrition',
  'yoga','fitness','running','cycling','hiking','walking','meditation',
  'parks_picnics','gardening','beaches','camping','travel','animal_welfare',
  'live_music','art_museums','films','reading','photography','crafts_diy',
  'workshops','languages','tech','board_games','writing',
  'volunteering','sustainability','activism'
);

CREATE TABLE IF NOT EXISTS public.interest_legacy_map (
  legacy_key   text PRIMARY KEY,
  interest_id  text NOT NULL REFERENCES public.interest_catalogue(id)
);
GRANT SELECT ON public.interest_legacy_map TO authenticated;
GRANT ALL ON public.interest_legacy_map TO service_role;
ALTER TABLE public.interest_legacy_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interest_legacy_map_read ON public.interest_legacy_map;
CREATE POLICY interest_legacy_map_read ON public.interest_legacy_map
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.interest_legacy_map (legacy_key, interest_id) VALUES
  ('books','reading'),
  ('book club','reading'),
  ('restaurants','dining_out'),
  ('food','vegan_food'),
  ('picnic','parks_picnics'),
  ('picnics','parks_picnics'),
  ('walks','walking'),
  ('walk','walking'),
  ('workshop','workshops'),
  ('music','live_music'),
  ('art','art_museums'),
  ('movies','films'),
  ('film','films'),
  ('diy','crafts_diy'),
  ('nutrition','plant_nutrition')
ON CONFLICT (legacy_key) DO UPDATE SET interest_id = EXCLUDED.interest_id;

CREATE OR REPLACE FUNCTION public.resolve_interest_id(_value text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT ic.id FROM public.interest_catalogue ic
      WHERE ic.active AND lower(ic.id) = lower(btrim(_value)) LIMIT 1),
    (SELECT ic.id FROM public.interest_catalogue ic
      WHERE ic.active AND lower(ic.label) = lower(btrim(_value)) LIMIT 1),
    (SELECT lm.interest_id FROM public.interest_legacy_map lm
      JOIN public.interest_catalogue ic ON ic.id = lm.interest_id AND ic.active
      WHERE lm.legacy_key = lower(btrim(_value)) LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.canonical_interest_ids(_values text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT ARRAY(
    SELECT DISTINCT ON (rid) rid
    FROM (
      SELECT public.resolve_interest_id(t.v) AS rid, t.ord
      FROM unnest(COALESCE(_values, ARRAY[]::text[])) WITH ORDINALITY AS t(v, ord)
    ) s
    WHERE rid IS NOT NULL
    ORDER BY rid, ord
  )
$$;

CREATE OR REPLACE FUNCTION public.canonical_interest_labels(_values text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT ARRAY(
    SELECT ic.label
    FROM unnest(public.canonical_interest_ids(_values)) AS t(id)
    JOIN public.interest_catalogue ic ON ic.id = t.id
    ORDER BY ic.group_sort, ic.sort_order
  )
$$;

REVOKE ALL ON FUNCTION public.resolve_interest_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_interest_ids(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_interest_labels(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_interest_labels(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_interests(_interests text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids   text[];
  v_bad   text;
BEGIN
  IF _interests IS NULL THEN RETURN NULL; END IF;

  SELECT btrim(c) INTO v_bad
  FROM unnest(_interests) AS c
  WHERE btrim(COALESCE(c,'')) <> ''
    AND public.resolve_interest_id(c) IS NULL
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unsupported interest: %', v_bad USING ERRCODE = '22023';
  END IF;

  v_ids := public.canonical_interest_ids(_interests);

  IF array_length(v_ids, 1) IS NULL OR array_length(v_ids, 1) < 3 THEN
    RAISE EXCEPTION 'pick at least 3 interests' USING ERRCODE = '22023';
  END IF;
  IF array_length(v_ids, 1) > 20 THEN
    RAISE EXCEPTION 'pick at most 20 interests' USING ERRCODE = '22023';
  END IF;

  RETURN public.canonical_interest_labels(_interests);
END $function$;

DO $$
DECLARE r RECORD; v text; rid text; new_labels text[];
BEGIN
  FOR r IN SELECT id, interests FROM public.profiles WHERE interests IS NOT NULL LOOP
    FOREACH v IN ARRAY r.interests LOOP
      rid := public.resolve_interest_id(v);
      IF rid IS NULL THEN
        INSERT INTO public.interest_migration_log (profile_id, entity, legacy_value, action, new_value)
        VALUES (r.id, 'profiles.interests', v, 'retained_unmapped', NULL);
      ELSIF lower(v) <> lower((SELECT label FROM public.interest_catalogue WHERE id = rid)) THEN
        INSERT INTO public.interest_migration_log (profile_id, entity, legacy_value, action, new_value)
        VALUES (r.id, 'profiles.interests', v, 'remapped',
                (SELECT label FROM public.interest_catalogue WHERE id = rid));
      END IF;
    END LOOP;

    new_labels := public.canonical_interest_labels(r.interests)
      || ARRAY(SELECT x FROM unnest(r.interests) x WHERE public.resolve_interest_id(x) IS NULL);

    UPDATE public.profiles SET interests = new_labels WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.meetups
  ADD COLUMN IF NOT EXISTS primary_interest_id text REFERENCES public.interest_catalogue(id),
  ADD COLUMN IF NOT EXISTS additional_interest_ids text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.validate_meetup_interest_tags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE bad text;
BEGIN
  NEW.additional_interest_ids := COALESCE(NEW.additional_interest_ids, '{}'::text[]);

  IF NEW.primary_interest_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.interest_catalogue
                    WHERE id = NEW.primary_interest_id AND active) THEN
      RAISE EXCEPTION 'unsupported primary interest: %', NEW.primary_interest_id
        USING ERRCODE = '22023';
    END IF;
  ELSIF array_length(NEW.additional_interest_ids, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'a primary interest is required before additional interests'
      USING ERRCODE = '22023';
  END IF;

  IF array_length(NEW.additional_interest_ids, 1) > 2 THEN
    RAISE EXCEPTION 'at most 2 additional interests' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(NEW.additional_interest_ids) x)
     <> COALESCE(array_length(NEW.additional_interest_ids, 1), 0) THEN
    RAISE EXCEPTION 'additional interests must be distinct' USING ERRCODE = '22023';
  END IF;

  IF NEW.primary_interest_id = ANY(NEW.additional_interest_ids) THEN
    RAISE EXCEPTION 'additional interests cannot repeat the primary interest'
      USING ERRCODE = '22023';
  END IF;

  SELECT x INTO bad FROM unnest(NEW.additional_interest_ids) x
  WHERE NOT EXISTS (SELECT 1 FROM public.interest_catalogue
                     WHERE id = x AND active) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'unsupported additional interest: %', bad USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_validate_meetup_interest_tags ON public.meetups;
CREATE TRIGGER trg_validate_meetup_interest_tags
  BEFORE INSERT OR UPDATE OF primary_interest_id, additional_interest_ids
  ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.validate_meetup_interest_tags();

UPDATE public.meetups m
SET primary_interest_id = map.interest_id
FROM (VALUES
  ('dinner','dining_out'),
  ('brunch','dining_out'),
  ('coffee','coffee'),
  ('picnic','parks_picnics'),
  ('cooking','cooking'),
  ('walk','walking'),
  ('workshop','workshops')
) AS map(cat, interest_id)
WHERE m.primary_interest_id IS NULL AND m.category::text = map.cat;

INSERT INTO public.interest_migration_log (entity, legacy_value, action, new_value)
SELECT 'meetups.category', m.category::text, 'retained_unmapped', NULL
FROM public.meetups m WHERE m.primary_interest_id IS NULL;

CREATE INDEX IF NOT EXISTS meetups_primary_interest_idx
  ON public.meetups (primary_interest_id);

CREATE OR REPLACE FUNCTION public.meetup_interest_score(
  _primary text,
  _additional text[],
  _viewer_interests text[]
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    (CASE WHEN _primary IS NOT NULL AND _primary = ANY(v.ids) THEN 40 ELSE 0 END)
    + COALESCE((
        SELECT (LEAST(2, count(*)) * 12)::int
        FROM unnest(COALESCE(_additional, '{}'::text[])) AS t(x)
        WHERE t.x = ANY(v.ids)
      ), 0)
  FROM (SELECT public.canonical_interest_ids(_viewer_interests) AS ids) v
$$;

REVOKE ALL ON FUNCTION public.meetup_interest_score(text, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meetup_interest_score(text, text[], text[]) TO authenticated;

DO $$
DECLARE src text; before text; after text;
BEGIN
  src := pg_get_functiondef('public.get_my_today_experience()'::regprocedure);

  before := '+ (CASE WHEN m.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN 20 ELSE 0 END) AS score';
  after  := '+ (CASE WHEN m.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN 20 ELSE 0 END)'
         || ' + public.meetup_interest_score(m.primary_interest_id, m.additional_interest_ids, my_interests) AS score';
  IF position(before IN src) = 0 THEN
    RAISE EXCEPTION 'WO-124: today scoring expression not found';
  END IF;
  src := replace(src, before, after);

  before := 'WHEN e.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN ''matches_your_interests''';
  after  := 'WHEN public.meetup_interest_score(e.primary_interest_id, e.additional_interest_ids, my_interests) > 0'
         || ' OR e.category::text = ANY(COALESCE(my_interests, ARRAY[]::text[])) THEN ''matches_your_interests''';
  IF position(before IN src) = 0 THEN
    RAISE EXCEPTION 'WO-124: today reason expression not found';
  END IF;
  src := replace(src, before, after);

  before := 'SELECT m.id, m.title, m.category, m.date, m.start_time, m.end_time, m.cover_image_url, m.host_id, m.capacity,';
  after  := 'SELECT m.id, m.title, m.category, m.date, m.start_time, m.end_time, m.cover_image_url, m.host_id, m.capacity,'
         || ' m.primary_interest_id, m.additional_interest_ids,';
  IF position(before IN src) = 0 THEN
    RAISE EXCEPTION 'WO-124: today eligible projection not found';
  END IF;
  src := replace(src, before, after);

  EXECUTE src;
END $$;

CREATE OR REPLACE FUNCTION public.create_hosted_meetup(
  _title text, _description text, _category text, _date date,
  _start_time time without time zone, _end_time time without time zone,
  _capacity integer, _city_id uuid, _community_place_id uuid, _location_name text,
  _address text, _neighborhood text, _latitude double precision,
  _longitude double precision, _timezone text, _cover_image_url text,
  _primary_interest_id text DEFAULT NULL,
  _additional_interest_ids text[] DEFAULT '{}'::text[]
)
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

  BEGIN
    cat := _category::public.meetup_category;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Choose a valid Meetup type';
  END;

  primary_id := public.resolve_interest_id(_primary_interest_id);
  IF primary_id IS NULL THEN
    RAISE EXCEPTION 'Choose what this Meetup is about' USING ERRCODE = '22023';
  END IF;
  additional_ids := ARRAY(
    SELECT x FROM unnest(public.canonical_interest_ids(_additional_interest_ids)) x
    WHERE x <> primary_id
  );
  IF array_length(additional_ids, 1) > 2 THEN
    RAISE EXCEPTION 'Pick at most 2 additional interests' USING ERRCODE = '22023';
  END IF;

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

REVOKE ALL ON FUNCTION public.create_hosted_meetup(text,text,text,date,time without time zone,time without time zone,integer,uuid,uuid,text,text,text,double precision,double precision,text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hosted_meetup(text,text,text,date,time without time zone,time without time zone,integer,uuid,uuid,text,text,text,double precision,double precision,text,text,text,text[]) TO authenticated;

DROP FUNCTION IF EXISTS public.create_hosted_meetup(text,text,text,date,time without time zone,time without time zone,integer,uuid,uuid,text,text,text,double precision,double precision,text,text);

CREATE OR REPLACE FUNCTION public.update_hosted_meetup(
  _meetup_id uuid, _title text, _description text, _date date,
  _start_time time without time zone, _end_time time without time zone,
  _capacity integer, _community_place_id uuid, _custom_location_name text,
  _custom_location_address text, _cover_image_url text,
  _primary_interest_id text DEFAULT NULL,
  _additional_interest_ids text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; m RECORD; active_count int;
  primary_id text; additional_ids text[];
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
    primary_interest_id = COALESCE(primary_id, primary_interest_id),
    additional_interest_ids = CASE WHEN primary_id IS NOT NULL
                                   THEN COALESCE(additional_ids, '{}'::text[])
                                   ELSE additional_interest_ids END,
    updated_at = now()
  WHERE id = _meetup_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text,text,text[]) TO authenticated;

DROP FUNCTION IF EXISTS public.update_hosted_meetup(uuid,text,text,date,time without time zone,time without time zone,integer,uuid,text,text,text);