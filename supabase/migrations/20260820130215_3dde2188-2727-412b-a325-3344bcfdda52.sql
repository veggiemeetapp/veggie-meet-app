ALTER TABLE public.meetups
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS google_maps_url text;

CREATE OR REPLACE FUNCTION public.set_meetup_google_location_meta(
  _meetup_id uuid,
  _google_place_id text,
  _google_maps_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  m RECORD;
  pid text;
  murl text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN RAISE EXCEPTION 'You can''t manage this Meetup.'; END IF;
  IF m.status = 'cancelled'::public.meetup_status THEN
    RAISE EXCEPTION 'This Meetup has already been cancelled.';
  END IF;

  pid := NULLIF(btrim(COALESCE(_google_place_id, '')), '');
  murl := NULLIF(btrim(COALESCE(_google_maps_url, '')), '');

  IF pid IS NOT NULL AND pid !~ '^[A-Za-z0-9_-]{5,200}$' THEN
    RAISE EXCEPTION 'Invalid place reference';
  END IF;
  IF murl IS NOT NULL AND (murl !~* '^https://[a-z0-9.-]*google\.[a-z.]+/' OR char_length(murl) > 500) THEN
    RAISE EXCEPTION 'Invalid map link';
  END IF;

  UPDATE public.meetups
     SET google_place_id = pid,
         google_maps_url = murl,
         updated_at = now()
   WHERE id = _meetup_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_meetup_google_location_meta(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_meetup_google_location_meta(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_meetup_google_location_meta(uuid, text, text) TO service_role;