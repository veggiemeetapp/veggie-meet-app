
-- =========================================================================
-- WO-035 Phase 1: Canonical location model
-- =========================================================================

-- Enum for meetup location source
DO $$ BEGIN
  CREATE TYPE public.location_source AS ENUM (
    'community_place',
    'host_selected_city',
    'custom_location',
    'migrated_place',
    'migrated_address',
    'migrated_host_city',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 1. cities
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cities_name_country_unique UNIQUE (normalized_name, country_code)
);

GRANT SELECT ON public.cities TO anon, authenticated;
GRANT ALL ON public.cities TO service_role;

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cities are viewable by everyone"
  ON public.cities FOR SELECT
  USING (true);

CREATE TRIGGER cities_updated_at
  BEFORE UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed a small default set. Coordinates are approximate city centers.
INSERT INTO public.cities (name, normalized_name, country_code, country_name, timezone, latitude, longitude)
VALUES
  ('Ho Chi Minh City', 'ho-chi-minh-city', 'VN', 'Vietnam', 'Asia/Ho_Chi_Minh', 10.7769, 106.7009),
  ('Hanoi',            'hanoi',            'VN', 'Vietnam', 'Asia/Ho_Chi_Minh', 21.0278, 105.8342),
  ('Da Nang',          'da-nang',          'VN', 'Vietnam', 'Asia/Ho_Chi_Minh', 16.0544, 108.2022),
  ('Singapore',        'singapore',        'SG', 'Singapore', 'Asia/Singapore',   1.3521, 103.8198),
  ('Bangkok',          'bangkok',          'TH', 'Thailand',  'Asia/Bangkok',   13.7563, 100.5018)
ON CONFLICT (normalized_name, country_code) DO NOTHING;

-- -------------------------------------------------------------------------
-- 2. profile_preferences (selected city + distance unit)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_preferences (
  profile_id UUID NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  selected_city_id UUID REFERENCES public.cities(id) ON DELETE SET NULL,
  distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_preferences TO authenticated;
GRANT ALL ON public.profile_preferences TO service_role;

ALTER TABLE public.profile_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own preferences"
  ON public.profile_preferences FOR SELECT
  TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE POLICY "Users insert their own preferences"
  ON public.profile_preferences FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());

CREATE POLICY "Users update their own preferences"
  ON public.profile_preferences FOR UPDATE
  TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());

CREATE TRIGGER profile_preferences_updated_at
  BEFORE UPDATE ON public.profile_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------
-- 3. profiles: add home_city_id (durable Home City)
-- -------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_city_id UUID REFERENCES public.cities(id) ON DELETE SET NULL;

-- Backfill home_city_id for anyone whose current_city text matches a known city.
UPDATE public.profiles p
   SET home_city_id = c.id
  FROM public.cities c
 WHERE p.home_city_id IS NULL
   AND p.current_city IS NOT NULL
   AND lower(btrim(p.current_city)) = lower(c.name);

-- -------------------------------------------------------------------------
-- 4. community_places: add city + coords + timezone + is_active
-- -------------------------------------------------------------------------
ALTER TABLE public.community_places
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Default existing places to HCMC (they're all HCMC seed data today).
UPDATE public.community_places p
   SET city_id = c.id,
       timezone = COALESCE(p.timezone, c.timezone)
  FROM public.cities c
 WHERE p.city_id IS NULL
   AND c.normalized_name = 'ho-chi-minh-city'
   AND c.country_code = 'VN';

CREATE INDEX IF NOT EXISTS community_places_city_id_idx
  ON public.community_places(city_id) WHERE is_active;

-- -------------------------------------------------------------------------
-- 5. meetups: add persisted location snapshot fields
-- -------------------------------------------------------------------------
ALTER TABLE public.meetups
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS country_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS location_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_source public.location_source,
  ADD COLUMN IF NOT EXISTS location_is_inferred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS meetups_city_id_idx ON public.meetups(city_id);

-- Coord sanity: both present or both null
ALTER TABLE public.meetups
  DROP CONSTRAINT IF EXISTS meetups_coords_both_or_neither;
ALTER TABLE public.meetups
  ADD CONSTRAINT meetups_coords_both_or_neither
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );

-- -------------------------------------------------------------------------
-- 6. Backfill meetups.location_* from priority rules
-- -------------------------------------------------------------------------

-- Rule 1: linked community place
UPDATE public.meetups m
   SET city_id                = COALESCE(m.city_id, cp.city_id),
       city_name_snapshot     = COALESCE(m.city_name_snapshot, c.name),
       country_code_snapshot  = COALESCE(m.country_code_snapshot, c.country_code),
       timezone               = COALESCE(m.timezone, cp.timezone, c.timezone),
       location_name          = COALESCE(m.location_name, cp.name),
       address                = COALESCE(m.address, cp.address),
       neighborhood           = COALESCE(m.neighborhood, cp.neighborhood),
       latitude               = COALESCE(m.latitude, cp.latitude),
       longitude              = COALESCE(m.longitude, cp.longitude),
       location_source        = COALESCE(m.location_source, 'migrated_place'::public.location_source),
       location_is_inferred   = COALESCE(m.location_source, 'migrated_place'::public.location_source) = 'migrated_place'::public.location_source,
       migrated_at            = COALESCE(m.migrated_at, now()),
       location_updated_at    = COALESCE(m.location_updated_at, now())
  FROM public.community_places cp
  LEFT JOIN public.cities c ON c.id = cp.city_id
 WHERE m.community_place_id = cp.id
   AND m.location_source IS NULL;

-- Rule 2: custom address text present
UPDATE public.meetups m
   SET location_name          = COALESCE(m.location_name, m.custom_location_name),
       address                = COALESCE(m.address, m.custom_location_address),
       location_source        = 'migrated_address'::public.location_source,
       location_is_inferred   = true,
       migrated_at            = COALESCE(m.migrated_at, now()),
       location_updated_at    = COALESCE(m.location_updated_at, now())
 WHERE m.location_source IS NULL
   AND (m.custom_location_name IS NOT NULL OR m.custom_location_address IS NOT NULL);

-- Rule 3: fall back to host's current_city (text match against cities)
UPDATE public.meetups m
   SET city_id                = c.id,
       city_name_snapshot     = c.name,
       country_code_snapshot  = c.country_code,
       timezone               = COALESCE(m.timezone, c.timezone),
       location_source        = 'migrated_host_city'::public.location_source,
       location_is_inferred   = true,
       migrated_at            = COALESCE(m.migrated_at, now()),
       location_updated_at    = COALESCE(m.location_updated_at, now())
  FROM public.profiles p
  JOIN public.cities c
    ON lower(btrim(p.current_city)) = lower(c.name)
 WHERE m.host_id = p.id
   AND m.location_source IS NULL;

-- Rule 4: unknown
UPDATE public.meetups
   SET location_source      = 'unknown'::public.location_source,
       location_is_inferred = true,
       migrated_at          = COALESCE(migrated_at, now()),
       location_updated_at  = COALESCE(location_updated_at, now())
 WHERE location_source IS NULL;

-- Fill any remaining timezone gaps with HCMC default for existing rows
UPDATE public.meetups m
   SET timezone = c.timezone
  FROM public.cities c
 WHERE m.timezone IS NULL
   AND c.normalized_name = 'ho-chi-minh-city' AND c.country_code = 'VN';

-- -------------------------------------------------------------------------
-- 7. meetup_location_changes (audit + notification idempotency)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meetup_location_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meetup_id UUID NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  changed_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  old_city_id UUID REFERENCES public.cities(id),
  new_city_id UUID REFERENCES public.cities(id),
  old_location_name TEXT,
  new_location_name TEXT,
  old_address TEXT,
  new_address TEXT,
  old_latitude DOUBLE PRECISION,
  old_longitude DOUBLE PRECISION,
  new_latitude DOUBLE PRECISION,
  new_longitude DOUBLE PRECISION,
  old_timezone TEXT,
  new_timezone TEXT,
  meaningful_change BOOLEAN NOT NULL DEFAULT false,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetup_location_changes_meetup_idx
  ON public.meetup_location_changes(meetup_id, changed_at DESC);

GRANT SELECT ON public.meetup_location_changes TO authenticated;
GRANT ALL ON public.meetup_location_changes TO service_role;

ALTER TABLE public.meetup_location_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Host reads their meetup location history"
  ON public.meetup_location_changes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetups m
       WHERE m.id = meetup_location_changes.meetup_id
         AND m.host_id = public.current_profile_id()
    )
  );

-- No INSERT/UPDATE/DELETE policies for authenticated: writes happen only via
-- SECURITY DEFINER RPC (update_meetup_location) that runs as service_role.
