CREATE OR REPLACE FUNCTION public.save_onboarding_step(_step text, _completed boolean DEFAULT true, _skipped boolean DEFAULT false, _next_step text DEFAULT NULL::text)
 RETURNS profile_onboarding_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
  row public.profile_onboarding_state;
  valid_steps text[] := ARRAY['welcome','auth','identity','dietary','home_city','selected_city','interests','photo','guidelines','safety','starting_point'];
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode='28000'; END IF;

  IF _step IS NULL OR NOT (_step = ANY(valid_steps)) THEN
    RAISE EXCEPTION 'unsupported onboarding step: %', COALESCE(_step,'(null)') USING errcode='22023';
  END IF;
  IF _next_step IS NOT NULL AND NOT (_next_step = ANY(valid_steps)) THEN
    RAISE EXCEPTION 'unsupported onboarding step: %', _next_step USING errcode='22023';
  END IF;

  INSERT INTO public.profile_onboarding_state (profile_id, current_step)
  VALUES (pid, COALESCE(_next_step, _step))
  ON CONFLICT (profile_id) DO NOTHING;

  UPDATE public.profile_onboarding_state
  SET
    completed_steps = CASE WHEN _completed AND NOT (_step = ANY(completed_steps))
                           THEN array_append(completed_steps, _step)
                           ELSE completed_steps END,
    skipped_steps   = CASE WHEN _skipped AND NOT (_step = ANY(skipped_steps))
                           THEN array_append(skipped_steps, _step)
                           ELSE skipped_steps END,
    -- Never regress a finished onboarding back into the flow, never let a client
    -- jump straight to 'done' (only complete_onboarding may set that), and never
    -- let a stale tab rewind progress: current_step only moves forward.
    current_step    = CASE
                        WHEN completed_at IS NOT NULL THEN 'done'
                        WHEN _next_step IS NULL THEN current_step
                        WHEN array_position(valid_steps, _next_step)
                             >= COALESCE(array_position(valid_steps, current_step), 0)
                          THEN _next_step
                        ELSE current_step
                      END
  WHERE profile_id = pid
  RETURNING * INTO row;

  RETURN row;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_onboarding_step(text, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_onboarding_step(text, boolean, boolean, text) TO authenticated;