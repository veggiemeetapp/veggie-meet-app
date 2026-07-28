CREATE OR REPLACE FUNCTION public.trg_activation_invitation_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'joined' AND (OLD.status IS DISTINCT FROM 'joined') THEN
    INSERT INTO public.profile_onboarding_state (profile_id) VALUES (NEW.recipient_id)
      ON CONFLICT (profile_id) DO NOTHING;
    UPDATE public.profile_onboarding_state
       SET first_meaningful_action_type      = COALESCE(first_meaningful_action_type, 'invitation_accepted'),
           first_meaningful_action_entity_id = COALESCE(first_meaningful_action_entity_id, NEW.meetup_id::text),
           first_meaningful_action_at        = COALESCE(first_meaningful_action_at, now())
     WHERE profile_id = NEW.recipient_id;
  END IF;
  RETURN NEW;
END;
$function$;