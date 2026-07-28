-- 1. Enforce block on friendships (insert + status transitions)
CREATE OR REPLACE FUNCTION public.enforce_friendship_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  will_be_active boolean;
BEGIN
  will_be_active := NEW.status IN ('pending'::friendship_status,'connected'::friendship_status,'verified'::friendship_status);
  IF NOT will_be_active THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = NEW.status
     AND OLD.profile_a_id = NEW.profile_a_id
     AND OLD.profile_b_id = NEW.profile_b_id THEN
    RETURN NEW;
  END IF;
  IF public.is_blocked_between(NEW.profile_a_id, NEW.profile_b_id) THEN
    RAISE EXCEPTION 'Connection unavailable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_friendship_block_trg ON public.friendships;
CREATE TRIGGER enforce_friendship_block_trg
BEFORE INSERT OR UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.enforce_friendship_block();

-- 2. join_from_invitation must refuse when the sender/recipient pair is blocked
CREATE OR REPLACE FUNCTION public.join_from_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; inv RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO inv FROM public.meetup_invitations WHERE id = _invitation_id;
  IF inv IS NULL OR inv.recipient_id <> me THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF public.is_blocked_between(inv.sender_id, inv.recipient_id) THEN
    RAISE EXCEPTION 'Invitation no longer available';
  END IF;

  PERFORM public.join_meetup(inv.meetup_id);

  UPDATE public.meetup_invitations
     SET status = 'joined',
         joined_at = COALESCE(joined_at, now()),
         viewed_at = COALESCE(viewed_at, now())
   WHERE id = _invitation_id;
END;
$$;

-- 3. get_my_meetup_summary: exclude blocked verified peers from the active list
CREATE OR REPLACE FUNCTION public.get_my_meetup_summary(_meetup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE me uuid; m RECORD; att_status text; place jsonb; host jsonb; verified jsonb; feedback jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  SELECT status::text INTO att_status FROM public.attendance
   WHERE meetup_id = _meetup_id AND profile_id = me
   ORDER BY updated_at DESC LIMIT 1;

  IF att_status IS NULL THEN
    RAISE EXCEPTION 'You did not attend this Meetup.';
  END IF;

  SELECT to_jsonb(p) - 'auth_user_id' INTO host
    FROM (SELECT id, display_name, avatar_url FROM public.profiles WHERE id = m.host_id) p;

  IF m.community_place_id IS NOT NULL THEN
    SELECT to_jsonb(cp) INTO place
      FROM (SELECT id, name, cover_image_url, address FROM public.community_places WHERE id = m.community_place_id) cp;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO verified
  FROM (
    SELECT p.id, p.display_name, p.avatar_url, p.interests
      FROM public.verified_meetup_connections v
      JOIN public.profiles p
        ON p.id = CASE WHEN v.profile_a_id = me THEN v.profile_b_id ELSE v.profile_a_id END
     WHERE v.meetup_id = _meetup_id
       AND (v.profile_a_id = me OR v.profile_b_id = me)
       AND NOT public.is_blocked_between(me, CASE WHEN v.profile_a_id = me THEN v.profile_b_id ELSE v.profile_a_id END)
     ORDER BY v.verified_at ASC
  ) x;

  SELECT to_jsonb(f) INTO feedback FROM (
    SELECT id, experience_rating::text AS rating, private_note, created_at, updated_at
      FROM public.meetup_feedback WHERE meetup_id = _meetup_id AND profile_id = me
  ) f;

  RETURN jsonb_build_object(
    'meetup', jsonb_build_object(
      'id', m.id, 'title', m.title, 'description', m.description,
      'date', m.date, 'start_time', m.start_time, 'end_time', m.end_time,
      'cover_image_url', m.cover_image_url,
      'custom_location_name', m.custom_location_name,
      'custom_location_address', m.custom_location_address,
      'status', m.status,
      'cancelled_at', m.cancelled_at,
      'has_ended', (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
    ),
    'host', host,
    'place', place,
    'attendance_status', att_status,
    'is_host', (m.host_id = me),
    'verified_connections', verified,
    'feedback', feedback
  );
END;
$$;