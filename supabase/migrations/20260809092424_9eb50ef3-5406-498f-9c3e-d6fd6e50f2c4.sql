-- WO-084A: `report` as a token also matched the approved `report_id`
-- dimension. Block the bare/free-text forms exactly, keep entity ids.
CREATE OR REPLACE FUNCTION public.analytics_sanitize_properties(_properties jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  src jsonb := COALESCE(_properties, '{}'::jsonb);
  out jsonb := '{}'::jsonb;
  deny_exact text[] := ARRAY['report','name','location','details','text'];
  k text;
  v jsonb;
  n int := 0;
BEGIN
  IF jsonb_typeof(src) <> 'object' THEN RETURN '{}'::jsonb; END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(src) LOOP
    EXIT WHEN n >= 12;
    CONTINUE WHEN length(k) > 40;
    CONTINUE WHEN lower(k) = ANY (deny_exact);
    CONTINUE WHEN k ~* '(^|_)(e?mail|token|jwt|password|secret|auth_user_id|user_id|profile_id|actor_id|recipient_id|sender_id|member_id|uid|lat|latitude|lng|lon|longitude|coord|coords|coordinate|coordinates|geo|geolocation|accuracy|position|address|location_name|place_name|body|content|message|bio|display_name|full_name|first_name|last_name|query|search_term|q|details_text|explanation|reason_text|note|stack|sql|raw_error)($|_)';
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