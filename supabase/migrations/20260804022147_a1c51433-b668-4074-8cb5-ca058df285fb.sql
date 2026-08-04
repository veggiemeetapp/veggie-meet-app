CREATE OR REPLACE FUNCTION public.enforce_meetup_community_place()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF cp IS NULL THEN
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

  -- Server is the source of truth for public place display fields.
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
$function$;

REVOKE ALL ON FUNCTION public.enforce_meetup_community_place() FROM PUBLIC;

DROP TRIGGER IF EXISTS zz_enforce_meetup_community_place ON public.meetups;
CREATE TRIGGER zz_enforce_meetup_community_place
BEFORE INSERT OR UPDATE ON public.meetups
FOR EACH ROW EXECUTE FUNCTION public.enforce_meetup_community_place();

CREATE INDEX IF NOT EXISTS meetups_place_schedule_idx
  ON public.meetups (community_place_id, date, start_time)
  WHERE community_place_id IS NOT NULL;