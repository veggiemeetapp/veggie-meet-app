CREATE OR REPLACE FUNCTION public.handle_check_in_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a uuid; b uuid;
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
    a := LEAST(NEW.requester_profile_id, NEW.target_profile_id);
    b := GREATEST(NEW.requester_profile_id, NEW.target_profile_id);
    INSERT INTO public.friendships (profile_a_id, profile_b_id, first_meetup_id, friends_since, status)
    VALUES (a, b, NEW.meetup_id, CURRENT_DATE, 'connected'::public.friendship_status)
    ON CONFLICT (profile_a_id, profile_b_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $function$;