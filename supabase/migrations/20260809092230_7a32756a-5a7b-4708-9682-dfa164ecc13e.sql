-- WO-084A DEF-084A-02 / DEF-084A-03:
-- 1) `profile_id` (a *foreign* member id) and `coordinates`/`location`/`geo`
--    were not covered by the denylist, so they were persisted verbatim.
-- 2) Anything slipping past the sanitizer hit validate_analytics_event()'s
--    RAISE, turning a best-effort telemetry write into a client-visible 400.
--    The sanitizer must be a superset of the trigger's forbidden list so the
--    guard can never fire from the trusted logger path.
CREATE OR REPLACE FUNCTION public.analytics_sanitize_properties(_properties jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  src jsonb := COALESCE(_properties, '{}'::jsonb);
  out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  n int := 0;
BEGIN
  IF jsonb_typeof(src) <> 'object' THEN RETURN '{}'::jsonb; END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(src) LOOP
    EXIT WHEN n >= 12;
    CONTINUE WHEN length(k) > 40;
    -- Superset of validate_analytics_event()'s forbidden list, plus member
    -- identifiers, geo data, free text, raw queries and raw error surfaces.
    CONTINUE WHEN k ~* '(^|_)(e?mail|token|jwt|password|secret|auth_user_id|user_id|profile_id|actor_id|recipient_id|sender_id|member_id|uid|lat|latitude|lng|lon|longitude|coord|coords|coordinate|coordinates|geo|location|accuracy|position|body|content|message|bio|display_name|name|query|search_term|q|details_text|explanation|reason_text|note|report|stack|sql|raw_error)($|_)';
    IF jsonb_typeof(v) IN ('object', 'array') THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v) = 'string' THEN
      v := to_jsonb(left(v #>> '{}', 64));
    END IF;
    out := out || jsonb_build_object(k, v);
    n := n + 1;
  END LOOP;

  IF octet_length(out::text) > 2048 THEN
    RETURN '{"truncated": true}'::jsonb;
  END IF;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_sanitize_properties(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_sanitize_properties(jsonb) TO authenticated;

-- Defence in depth: the trigger keeps rejecting forbidden keys for any other
-- writer, but the sanitized logger path can no longer reach it.
CREATE OR REPLACE FUNCTION public.validate_analytics_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  forbidden text[] := ARRAY['bio','email','password','coordinates','latitude','longitude','message','report','profile_id','auth_user_id','user_id'];
  k text;
BEGIN
  IF NEW.properties IS NOT NULL THEN
    FOREACH k IN ARRAY forbidden LOOP
      IF NEW.properties ? k THEN
        RAISE EXCEPTION 'analytics payload may not contain %', k;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;