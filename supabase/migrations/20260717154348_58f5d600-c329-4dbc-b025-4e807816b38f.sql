
-- Extend friendship_status with the two new relationship states.
ALTER TYPE public.friendship_status ADD VALUE IF NOT EXISTS 'verified';
ALTER TYPE public.friendship_status ADD VALUE IF NOT EXISTS 'removed';

-- Track who initiated a connection request (survives A/B canonicalization).
ALTER TABLE public.friendships
  ADD COLUMN IF NOT EXISTS requester_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Allow participants to update / delete their own friendship row (accept, decline, remove).
DROP POLICY IF EXISTS "Participants can update friendships" ON public.friendships;
CREATE POLICY "Participants can update friendships"
ON public.friendships FOR UPDATE
USING (profile_a_id = current_profile_id() OR profile_b_id = current_profile_id())
WITH CHECK (profile_a_id = current_profile_id() OR profile_b_id = current_profile_id());

DROP POLICY IF EXISTS "Participants can delete friendships" ON public.friendships;
CREATE POLICY "Participants can delete friendships"
ON public.friendships FOR DELETE
USING (profile_a_id = current_profile_id() OR profile_b_id = current_profile_id());

-- QR check-in confirmations now create/upgrade the friendship to 'verified'.
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
    INSERT INTO public.friendships (profile_a_id, profile_b_id, first_meetup_id, friends_since, status, requester_id)
    VALUES (a, b, NEW.meetup_id, CURRENT_DATE, 'verified'::public.friendship_status, NEW.requester_profile_id)
    ON CONFLICT (profile_a_id, profile_b_id) DO UPDATE
      SET status = 'verified'::public.friendship_status,
          first_meetup_id = COALESCE(public.friendships.first_meetup_id, EXCLUDED.first_meetup_id),
          friends_since = LEAST(public.friendships.friends_since, EXCLUDED.friends_since);
  END IF;
  RETURN NEW;
END;
$function$;
