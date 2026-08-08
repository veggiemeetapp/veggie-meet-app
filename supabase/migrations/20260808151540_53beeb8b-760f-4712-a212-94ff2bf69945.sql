-- Timezone lookups are configuration-dependent, so these helpers must be
-- STABLE (not IMMUTABLE) to prevent the planner from constant-folding them.
CREATE OR REPLACE FUNCTION public.meetup_start_at(_date date, _start_time time without time zone, _timezone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ((_date::timestamp + _start_time) AT TIME ZONE COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'));
$$;

CREATE OR REPLACE FUNCTION public.meetup_end_at(_date date, _start_time time without time zone, _end_time time without time zone, _timezone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ((_date::timestamp + COALESCE(_end_time, _start_time + INTERVAL '2 hours')
           + CASE WHEN _end_time IS NOT NULL AND _end_time < _start_time
                  THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
          AT TIME ZONE COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'));
$$;

CREATE OR REPLACE FUNCTION public.is_valid_timezone(_tz text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
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

REVOKE ALL ON FUNCTION public.meetup_start_at(date, time without time zone, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meetup_end_at(date, time without time zone, time without time zone, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_timezone(text) FROM PUBLIC;
