-- WO-067: server-authoritative People relationship lifecycle.

-- 1. Narrow RPCs -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_connection_request(_target_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; a uuid; b uuid; row_rec record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _target_profile_id IS NULL OR _target_profile_id = me THEN
    RETURN jsonb_build_object('state','invalid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_profile_id) THEN
    RETURN jsonb_build_object('state','invalid');
  END IF;
  IF public.is_blocked_between(me, _target_profile_id) THEN
    RETURN jsonb_build_object('state','unavailable');
  END IF;

  a := LEAST(me, _target_profile_id);
  b := GREATEST(me, _target_profile_id);

  SELECT * INTO row_rec FROM public.friendships
   WHERE profile_a_id = a AND profile_b_id = b FOR UPDATE;

  IF row_rec.id IS NOT NULL THEN
    IF row_rec.status IN ('connected','verified') THEN
      RETURN jsonb_build_object('state','already_connected','friendship_id',row_rec.id);
    ELSIF row_rec.status = 'pending' THEN
      IF row_rec.requester_id IS NOT NULL AND row_rec.requester_id <> me THEN
        -- reverse request already exists -> mutual intent, accept it
        UPDATE public.friendships SET status = 'connected' WHERE id = row_rec.id;
        RETURN jsonb_build_object('state','connected','friendship_id',row_rec.id);
      END IF;
      RETURN jsonb_build_object('state','already_pending','friendship_id',row_rec.id);
    ELSIF row_rec.status = 'blocked' THEN
      RETURN jsonb_build_object('state','unavailable');
    ELSE -- removed
      UPDATE public.friendships
         SET status = 'pending', requester_id = me
       WHERE id = row_rec.id;
      RETURN jsonb_build_object('state','requested','friendship_id',row_rec.id);
    END IF;
  END IF;

  INSERT INTO public.friendships (profile_a_id, profile_b_id, requester_id, status, friends_since)
  VALUES (a, b, me, 'pending', CURRENT_DATE)
  ON CONFLICT (profile_a_id, profile_b_id) DO NOTHING
  RETURNING id INTO row_rec.id;

  IF row_rec.id IS NULL THEN
    SELECT id INTO row_rec.id FROM public.friendships WHERE profile_a_id = a AND profile_b_id = b;
    RETURN jsonb_build_object('state','already_pending','friendship_id',row_rec.id);
  END IF;
  RETURN jsonb_build_object('state','requested','friendship_id',row_rec.id);
END; $$;

CREATE OR REPLACE FUNCTION public.accept_connection_request(_friendship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; row_rec record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO row_rec FROM public.friendships WHERE id = _friendship_id FOR UPDATE;
  IF row_rec.id IS NULL THEN RETURN jsonb_build_object('state','not_found'); END IF;
  IF me NOT IN (row_rec.profile_a_id, row_rec.profile_b_id) THEN
    RETURN jsonb_build_object('state','not_found');
  END IF;
  IF row_rec.status IN ('connected','verified') THEN
    RETURN jsonb_build_object('state','already_connected','friendship_id',row_rec.id);
  END IF;
  IF row_rec.status <> 'pending' THEN RETURN jsonb_build_object('state','not_pending'); END IF;
  -- only the recipient may accept
  IF row_rec.requester_id IS NULL OR row_rec.requester_id = me THEN
    RETURN jsonb_build_object('state','not_recipient');
  END IF;
  IF public.is_blocked_between(row_rec.profile_a_id, row_rec.profile_b_id) THEN
    RETURN jsonb_build_object('state','unavailable');
  END IF;

  UPDATE public.friendships SET status = 'connected' WHERE id = row_rec.id;
  RETURN jsonb_build_object('state','connected','friendship_id',row_rec.id);
END; $$;

CREATE OR REPLACE FUNCTION public.decline_connection_request(_friendship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; row_rec record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO row_rec FROM public.friendships WHERE id = _friendship_id FOR UPDATE;
  IF row_rec.id IS NULL THEN RETURN jsonb_build_object('state','not_found'); END IF;
  IF me NOT IN (row_rec.profile_a_id, row_rec.profile_b_id) THEN
    RETURN jsonb_build_object('state','not_found');
  END IF;
  IF row_rec.status <> 'pending' THEN RETURN jsonb_build_object('state','not_pending'); END IF;
  IF row_rec.requester_id = me THEN RETURN jsonb_build_object('state','not_recipient'); END IF;
  DELETE FROM public.friendships WHERE id = row_rec.id;
  RETURN jsonb_build_object('state','declined');
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_connection_request(_friendship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; row_rec record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO row_rec FROM public.friendships WHERE id = _friendship_id FOR UPDATE;
  IF row_rec.id IS NULL THEN RETURN jsonb_build_object('state','not_found'); END IF;
  IF me NOT IN (row_rec.profile_a_id, row_rec.profile_b_id) THEN
    RETURN jsonb_build_object('state','not_found');
  END IF;
  IF row_rec.status <> 'pending' THEN RETURN jsonb_build_object('state','not_pending'); END IF;
  IF row_rec.requester_id IS DISTINCT FROM me THEN RETURN jsonb_build_object('state','not_sender'); END IF;
  DELETE FROM public.friendships WHERE id = row_rec.id;
  RETURN jsonb_build_object('state','cancelled');
END; $$;

CREATE OR REPLACE FUNCTION public.remove_connection(_friendship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid; row_rec record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO row_rec FROM public.friendships WHERE id = _friendship_id FOR UPDATE;
  IF row_rec.id IS NULL THEN RETURN jsonb_build_object('state','not_found'); END IF;
  IF me NOT IN (row_rec.profile_a_id, row_rec.profile_b_id) THEN
    RETURN jsonb_build_object('state','not_found');
  END IF;
  IF row_rec.status = 'removed' THEN RETURN jsonb_build_object('state','removed'); END IF;
  -- Historical Verified Connections (verified_meetup_connections) are preserved:
  -- disconnecting only ends the active relationship.
  UPDATE public.friendships SET status = 'removed' WHERE id = row_rec.id;
  RETURN jsonb_build_object('state','removed');
END; $$;

-- 2. Verified count derives from real verifications, not friendships.status ---

CREATE OR REPLACE FUNCTION public.get_profile_connection_summary(_target_profile_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (SELECT current_profile_id() AS pid),
  target_conn AS (
    SELECT CASE WHEN profile_a_id = _target_profile_id THEN profile_b_id ELSE profile_a_id END AS other
    FROM friendships
    WHERE status IN ('connected','verified')
      AND _target_profile_id IN (profile_a_id, profile_b_id)
  ),
  my_conn AS (
    SELECT CASE WHEN profile_a_id = (SELECT pid FROM me) THEN profile_b_id ELSE profile_a_id END AS other
    FROM friendships
    WHERE status IN ('connected','verified')
      AND (SELECT pid FROM me) IN (profile_a_id, profile_b_id)
  ),
  mutual AS (
    SELECT p.id, p.display_name, p.avatar_url
    FROM profiles p
    WHERE p.id IN (SELECT other FROM target_conn INTERSECT SELECT other FROM my_conn)
      AND p.id <> (SELECT pid FROM me)
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'verified_connections', (
      SELECT count(*) FROM public._legit_verified_pairs(_target_profile_id)
    ),
    'mutual_connections', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'profileId', id, 'displayName', display_name, 'avatarUrl', avatar_url)) FROM mutual),
      '[]'::jsonb)
  )
  WHERE (SELECT pid FROM me) IS NOT NULL;
$$;

-- 3. Remove direct member write access to friendships -----------------------

DROP POLICY IF EXISTS "Users can create friendships they're part of" ON public.friendships;
DROP POLICY IF EXISTS "Participants can update friendships" ON public.friendships;
DROP POLICY IF EXISTS "Participants can delete friendships" ON public.friendships;

REVOKE INSERT, UPDATE, DELETE ON public.friendships FROM authenticated;
REVOKE ALL ON public.friendships FROM anon, PUBLIC;
GRANT SELECT ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;

-- 4. Function privileges ----------------------------------------------------

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.send_connection_request(uuid)',
    'public.accept_connection_request(uuid)',
    'public.decline_connection_request(uuid)',
    'public.cancel_connection_request(uuid)',
    'public.remove_connection(uuid)',
    'public.get_profile_connection_summary(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;