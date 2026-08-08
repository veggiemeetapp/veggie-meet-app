CREATE OR REPLACE FUNCTION public.get_my_onboarding_state()
 RETURNS profile_onboarding_state
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
  row public.profile_onboarding_state;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '28000';
  END IF;
  SELECT * INTO row FROM public.profile_onboarding_state WHERE profile_id = pid;
  IF NOT FOUND THEN
    INSERT INTO public.profile_onboarding_state (profile_id) VALUES (pid)
    ON CONFLICT (profile_id) DO NOTHING;
    SELECT * INTO row FROM public.profile_onboarding_state WHERE profile_id = pid;
  END IF;
  RETURN row;
END;
$function$;