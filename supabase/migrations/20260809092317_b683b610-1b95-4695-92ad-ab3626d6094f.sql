-- WO-084A: the previous pass over-blocked. Bare `name` also matched
-- `error_name`, and bare `location` also matched `location_source` — both are
-- approved, non-identifying measurement dimensions. Block the identifying
-- variants explicitly instead of the generic tokens.
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
    CONTINUE WHEN k ~* '(^|_)(e?mail|token|jwt|password|secret|auth_user_id|user_id|profile_id|actor_id|recipient_id|sender_id|member_id|uid|lat|latitude|lng|lon|longitude|coord|coords|coordinate|coordinates|geo|geolocation|accuracy|position|address|location_name|place_name|body|content|message|bio|display_name|full_name|first_name|last_name|query|search_term|q|details_text|explanation|reason_text|note|report|stack|sql|raw_error)($|_)';
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