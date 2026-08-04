CREATE OR REPLACE FUNCTION public.snapshot_meetup_location_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE cp RECORD; c RECORD; viewer_city uuid; cp_found boolean := false;
BEGIN
  IF NEW.community_place_id IS NOT NULL AND (NEW.city_id IS NULL OR NEW.timezone IS NULL) THEN
    SELECT cp2.*, ci.name AS ci_name, ci.country_code AS ci_country, ci.timezone AS ci_tz
      INTO cp
      FROM public.community_places cp2
      LEFT JOIN public.cities ci ON ci.id = cp2.city_id
     WHERE cp2.id = NEW.community_place_id;
    cp_found := FOUND;
    IF cp_found THEN
      NEW.city_id                := COALESCE(NEW.city_id, cp.city_id);
      NEW.city_name_snapshot     := COALESCE(NEW.city_name_snapshot, cp.ci_name);
      NEW.country_code_snapshot  := COALESCE(NEW.country_code_snapshot, cp.ci_country);
      NEW.timezone               := COALESCE(NEW.timezone, cp.timezone, cp.ci_tz);
      NEW.neighborhood           := COALESCE(NEW.neighborhood, cp.neighborhood);
      NEW.location_name          := COALESCE(NEW.location_name, cp.name);
      NEW.address                := COALESCE(NEW.address, cp.address);
      NEW.latitude               := COALESCE(NEW.latitude, cp.latitude);
      NEW.longitude              := COALESCE(NEW.longitude, cp.longitude);
      NEW.location_source        := COALESCE(NEW.location_source, 'community_place'::public.location_source);
    END IF;
  END IF;

  IF NEW.city_id IS NULL THEN
    viewer_city := public.resolve_viewer_city_id(NEW.host_id);
    IF viewer_city IS NOT NULL THEN
      SELECT * INTO c FROM public.cities WHERE id = viewer_city;
      IF FOUND THEN
        NEW.city_id               := c.id;
        NEW.city_name_snapshot    := COALESCE(NEW.city_name_snapshot, c.name);
        NEW.country_code_snapshot := COALESCE(NEW.country_code_snapshot, c.country_code);
        NEW.timezone              := COALESCE(NEW.timezone, c.timezone);
        NEW.location_source       := COALESCE(NEW.location_source, 'host_selected_city'::public.location_source);
        NEW.location_is_inferred  := true;
      END IF;
    END IF;
  END IF;

  IF NEW.location_source IS NULL THEN
    NEW.location_source      := 'unknown'::public.location_source;
    NEW.location_is_inferred := true;
  END IF;
  NEW.location_updated_at := COALESCE(NEW.location_updated_at, now());
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.enforce_meetup_community_place()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE cp RECORD;
BEGIN
  IF NEW.community_place_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.*, ci.name AS ci_name, ci.country_code AS ci_country, ci.timezone AS ci_tz
    INTO cp
    FROM public.community_places p
    LEFT JOIN public.cities ci ON ci.id = p.city_id
   WHERE p.id = NEW.community_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This place isn''t available. [place_unavailable]';
  END IF;
  IF cp.verification_status <> 'verified'
     OR cp.is_active IS NOT TRUE
     OR (cp.business_status IS NOT NULL AND cp.business_status <> 'OPERATIONAL') THEN
    RAISE EXCEPTION 'This place isn''t available. [place_unavailable]';
  END IF;
  IF cp.city_id IS NULL THEN
    RAISE EXCEPTION 'This place isn''t available in your city. [unsupported_city]';
  END IF;
  IF NEW.city_id IS NOT NULL AND NEW.city_id <> cp.city_id THEN
    RAISE EXCEPTION 'This place isn''t available in your city. [unsupported_city]';
  END IF;

  NEW.city_id               := cp.city_id;
  NEW.city_name_snapshot    := cp.ci_name;
  NEW.country_code_snapshot := cp.ci_country;
  NEW.timezone              := COALESCE(cp.timezone, cp.ci_tz, NEW.timezone);
  NEW.neighborhood          := cp.neighborhood;
  NEW.location_name         := cp.name;
  NEW.address               := cp.address;
  NEW.latitude              := cp.latitude;
  NEW.longitude             := cp.longitude;
  NEW.location_source       := 'community_place'::public.location_source;
  NEW.location_is_inferred  := false;
  NEW.custom_location_name  := NULL;
  NEW.custom_location_address := NULL;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.snapshot_meetup_location_on_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_meetup_community_place() FROM PUBLIC;