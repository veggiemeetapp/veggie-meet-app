
-- Canonicalize friendships so (a,b) is always stored with a<b, preventing duplicates in either direction.
CREATE OR REPLACE FUNCTION public.canonicalize_friendship()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE tmp uuid;
BEGIN
  IF NEW.profile_a_id = NEW.profile_b_id THEN
    RAISE EXCEPTION 'Cannot befriend self';
  END IF;
  IF NEW.profile_a_id > NEW.profile_b_id THEN
    tmp := NEW.profile_a_id;
    NEW.profile_a_id := NEW.profile_b_id;
    NEW.profile_b_id := tmp;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS canonicalize_friendship_trg ON public.friendships;
CREATE TRIGGER canonicalize_friendship_trg
BEFORE INSERT OR UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_friendship();

-- Check-in requests: one attendee scans another; recipient must confirm.
CREATE TABLE IF NOT EXISTS public.check_in_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id UUID NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  requester_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_profile_id <> target_profile_id),
  CHECK (status IN ('pending','confirmed','declined'))
);

CREATE UNIQUE INDEX IF NOT EXISTS check_in_requests_unique_pending
  ON public.check_in_requests (meetup_id, requester_profile_id, target_profile_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS check_in_requests_target_idx
  ON public.check_in_requests (target_profile_id, status);

GRANT SELECT, INSERT, UPDATE ON public.check_in_requests TO authenticated;
GRANT ALL ON public.check_in_requests TO service_role;

ALTER TABLE public.check_in_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their check-in requests"
  ON public.check_in_requests FOR SELECT
  TO authenticated
  USING (
    requester_profile_id = public.current_profile_id()
    OR target_profile_id = public.current_profile_id()
  );

CREATE POLICY "Attendees can create check-in requests"
  ON public.check_in_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    requester_profile_id = public.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.attendance a1
      WHERE a1.meetup_id = check_in_requests.meetup_id
        AND a1.profile_id = requester_profile_id
        AND a1.status <> 'cancelled'
    )
    AND EXISTS (
      SELECT 1 FROM public.attendance a2
      WHERE a2.meetup_id = check_in_requests.meetup_id
        AND a2.profile_id = target_profile_id
        AND a2.status <> 'cancelled'
    )
  );

CREATE POLICY "Target can respond to their check-in requests"
  ON public.check_in_requests FOR UPDATE
  TO authenticated
  USING (target_profile_id = public.current_profile_id())
  WITH CHECK (target_profile_id = public.current_profile_id());

CREATE TRIGGER set_check_in_requests_updated_at
  BEFORE UPDATE ON public.check_in_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- When a check-in request becomes confirmed, create a friendship if none exists.
CREATE OR REPLACE FUNCTION public.handle_check_in_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a uuid; b uuid;
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
    a := LEAST(NEW.requester_profile_id, NEW.target_profile_id);
    b := GREATEST(NEW.requester_profile_id, NEW.target_profile_id);
    INSERT INTO public.friendships (profile_a_id, profile_b_id, first_meetup_id, friends_since, status)
    VALUES (a, b, NEW.meetup_id, CURRENT_DATE, 'active')
    ON CONFLICT (profile_a_id, profile_b_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS check_in_confirmed_trg ON public.check_in_requests;
CREATE TRIGGER check_in_confirmed_trg
AFTER UPDATE ON public.check_in_requests
FOR EACH ROW EXECUTE FUNCTION public.handle_check_in_confirmed();
