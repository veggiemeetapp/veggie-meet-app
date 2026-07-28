
ALTER TABLE public.profile_preferences
  ADD COLUMN IF NOT EXISTS notification_permission_result text
    CHECK (notification_permission_result IS NULL OR notification_permission_result IN ('granted','denied','dismissed','unsupported')),
  ADD COLUMN IF NOT EXISTS notification_permission_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_permission_result text
    CHECK (location_permission_result IS NULL OR location_permission_result IN ('granted','denied','dismissed','unsupported')),
  ADD COLUMN IF NOT EXISTS location_permission_asked_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_permission_result(
  _kind text,
  _result text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid := current_profile_id();
BEGIN
  IF pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _kind NOT IN ('notification','location') THEN
    RAISE EXCEPTION 'invalid permission kind: %', _kind;
  END IF;
  IF _result NOT IN ('granted','denied','dismissed','unsupported') THEN
    RAISE EXCEPTION 'invalid permission result: %', _result;
  END IF;

  INSERT INTO public.profile_preferences(profile_id) VALUES (pid)
  ON CONFLICT (profile_id) DO NOTHING;

  IF _kind = 'notification' THEN
    UPDATE public.profile_preferences
      SET notification_permission_result = _result,
          notification_permission_asked_at = now()
      WHERE profile_id = pid;
  ELSE
    UPDATE public.profile_preferences
      SET location_permission_result = _result,
          location_permission_asked_at = now()
      WHERE profile_id = pid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_permission_result(text, text) TO authenticated;
