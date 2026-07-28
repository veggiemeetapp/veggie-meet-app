CREATE OR REPLACE FUNCTION public.meetup_in_check_in_window(_meetup_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m RECORD; opens TIMESTAMPTZ; closes TIMESTAMPTZ; tz TEXT;
BEGIN
  SELECT date, start_time, end_time, status, timezone
    INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RETURN 'missing'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN RETURN 'cancelled'; END IF;
  tz := COALESCE(m.timezone, 'UTC');
  opens  := ((m.date::timestamp + m.start_time) AT TIME ZONE tz) - INTERVAL '60 minutes';
  closes := ((m.date::timestamp + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) AT TIME ZONE tz)
            + INTERVAL '4 hours';
  IF now() < opens THEN RETURN 'too_early'; END IF;
  IF now() > closes THEN RETURN 'closed'; END IF;
  RETURN 'open';
END; $function$;