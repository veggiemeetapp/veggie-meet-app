-- ============================================================
-- WO-074 — Account deletion & personal data lifecycle
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON public.profiles (deleted_at) WHERE deleted_at IS NOT NULL;

-- deleted_at is internal: members must never read it directly.
REVOKE ALL (deleted_at) ON public.profiles FROM anon, authenticated;

-- Tombstoned profiles disappear from every direct (non-SECDEF) read.
DROP POLICY IF EXISTS "Bounded profile visibility" ON public.profiles;
CREATE POLICY "Bounded profile visibility"
ON public.profiles FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    auth_user_id = auth.uid()
    OR (
      onboarding_completed
      AND NOT public.is_blocked_with_me(id)
      AND (
        discovery_visible
        OR public.are_connected(public.current_profile_id(), id)
        OR public.shares_context_with(id)
      )
    )
  )
);

-- ------------------------------------------------------------
-- Deleted members are unreachable through the profile route.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_veggie_profile_availability(_target_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid; exists_row boolean;
BEGIN
  me := public.current_profile_id();
  IF _target_profile_id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unavailable');
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
     WHERE id = _target_profile_id AND deleted_at IS NULL
  ) INTO exists_row;
  IF NOT exists_row THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unavailable');
  END IF;
  IF me IS NOT NULL AND me <> _target_profile_id
     AND public.is_blocked_between(me, _target_profile_id) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unavailable');
  END IF;
  RETURN jsonb_build_object('available', true);
END;
$function$;

-- ------------------------------------------------------------
-- Server-authoritative self-deletion. Actor derived from auth only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid  uuid := public.current_profile_id();
  v_auth uuid;
  v_deleted_at timestamptz;
  v_hosted int := 0;
  v_attending int := 0;
  v_req_id uuid;
  v_meetup record;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT auth_user_id, deleted_at INTO v_auth, v_deleted_at
    FROM public.profiles WHERE id = v_pid FOR UPDATE;

  -- Idempotency: never run the destructive path twice.
  IF v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status','already_deleted',
      'request_id', (SELECT id FROM public.account_deletion_requests
                      WHERE profile_id = v_pid ORDER BY requested_at DESC LIMIT 1),
      'future_hosted_meetup_count', 0,
      'future_attendance_count', 0
    );
  END IF;

  -- Deletion request row first, so a mid-flight failure leaves a resumable trace.
  INSERT INTO public.account_deletion_requests(profile_id, status)
  VALUES (v_pid, 'pending')
  RETURNING id INTO v_req_id;

  -- 1) Cancel every upcoming Meetup this member hosts (no ownerless Meetups,
  --    no silent host transfer). Attendees are told it was cancelled.
  FOR v_meetup IN
    SELECT id FROM public.meetups
     WHERE host_id = v_pid
       AND status IN ('upcoming','full','in_progress')
  LOOP
    v_hosted := v_hosted + 1;

    UPDATE public.meetups
       SET status = 'cancelled',
           cancellation_reason = 'The host deleted their VeggieMeet account.',
           cancelled_at = now(),
           updated_at = now()
     WHERE id = v_meetup.id;

    INSERT INTO public.notifications
      (recipient_id, actor_id, type, entity_type, entity_id,
       destination_type, destination_id, title, body, metadata, dedup_key)
    SELECT a.profile_id, NULL, 'meetup_cancelled', 'meetup', v_meetup.id,
           'meetup', v_meetup.id,
           'Meetup cancelled',
           'This Meetup was cancelled because the host left VeggieMeet.',
           '{}'::jsonb,
           'meetup_cancelled:' || v_meetup.id || ':' || a.profile_id
      FROM public.attendance a
     WHERE a.meetup_id = v_meetup.id
       AND a.profile_id <> v_pid
       AND a.status IN ('joined','checked_in')
    ON CONFLICT (dedup_key) DO NOTHING;

    UPDATE public.attendance
       SET status = 'cancelled', updated_at = now()
     WHERE meetup_id = v_meetup.id
       AND status IN ('joined','checked_in');
  END LOOP;

  -- 2) Drop upcoming participation in other members' Meetups (set-based).
  SELECT count(*) INTO v_attending
    FROM public.attendance a
    JOIN public.meetups m ON m.id = a.meetup_id
   WHERE a.profile_id = v_pid
     AND a.status IN ('joined','checked_in')
     AND m.status IN ('upcoming','full','in_progress');

  DELETE FROM public.chat_participants cp
   USING public.chats c, public.meetups m
   WHERE cp.profile_id = v_pid
     AND c.id = cp.chat_id
     AND m.id = c.meetup_id
     AND m.status IN ('upcoming','full','in_progress','cancelled');

  DELETE FROM public.attendance a
   USING public.meetups m
   WHERE a.profile_id = v_pid
     AND m.id = a.meetup_id
     AND m.status IN ('upcoming','full','in_progress','cancelled');

  -- 3) Pending / actionable social state — neutralised outright.
  DELETE FROM public.meetup_invitations
   WHERE sender_id = v_pid OR recipient_id = v_pid;
  DELETE FROM public.meetup_qr_tokens WHERE issuer_profile_id = v_pid;
  DELETE FROM public.friendships
   WHERE profile_a_id = v_pid OR profile_b_id = v_pid;
  DELETE FROM public.user_blocks
   WHERE blocker_profile_id = v_pid OR blocked_profile_id = v_pid;

  -- 4) Direct messages. Conversations attached to a safety report are kept as
  --    moderation evidence (sender renders as the anonymous tombstone only).
  DELETE FROM public.dm_messages dm
   WHERE dm.conversation_id IN (
     SELECT c.id FROM public.dm_conversations c
      WHERE (c.user_a_id = v_pid OR c.user_b_id = v_pid)
        AND NOT EXISTS (SELECT 1 FROM public.user_reports r WHERE r.conversation_id = c.id)
   )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_reports r WHERE r.reported_message_id = dm.id
     );

  DELETE FROM public.dm_conversations c
   WHERE (c.user_a_id = v_pid OR c.user_b_id = v_pid)
     AND NOT EXISTS (SELECT 1 FROM public.user_reports r WHERE r.conversation_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.dm_messages dm WHERE dm.conversation_id = c.id);

  -- 5) Personal, non-historical records.
  DELETE FROM public.notifications
   WHERE recipient_id = v_pid OR actor_id = v_pid;
  DELETE FROM public.notification_preferences WHERE profile_id = v_pid;
  DELETE FROM public.profile_preferences WHERE profile_id = v_pid;
  DELETE FROM public.profile_onboarding_state WHERE profile_id = v_pid;
  DELETE FROM public.recommendation_feedback WHERE profile_id = v_pid;
  DELETE FROM public.meetup_update_seen WHERE profile_id = v_pid;
  DELETE FROM public.meetup_follow_up_state WHERE profile_id = v_pid;
  DELETE FROM public.meetup_feedback WHERE profile_id = v_pid;
  DELETE FROM public.community_place_visits WHERE profile_id = v_pid;
  DELETE FROM public.analytics_events WHERE profile_id = v_pid;

  -- 6) RETAINED (anonymised via the tombstone, never re-identifiable):
  --    verified_meetup_connections, meetup_completions, past attendance,
  --    messages (Meetup chat), user_reports / safety_reports / meetup_reports /
  --    community_place_reports, community_place_suggestions and every owner
  --    place-history table. Community Places themselves are untouched.

  -- 7) Erase personal identity, keep an anonymous historical subject row.
  UPDATE public.profiles
     SET display_name = 'Former Veggie',
         bio = '',
         avatar_url = NULL,
         pronouns = NULL,
         interests = '{}',
         dietary_identity = NULL,
         current_city = NULL,
         home_city_id = NULL,
         community_guidelines_accepted_at = NULL,
         is_active_host = false,
         discovery_visible = false,
         onboarding_completed = false,
         auth_user_id = NULL,
         deleted_at = now(),
         updated_at = now()
   WHERE id = v_pid;

  UPDATE public.account_deletion_requests
     SET status = 'completed', effective_at = now(), updated_at = now()
   WHERE id = v_req_id;

  -- 8) Auth identity. Same transaction as the data purge, so there is no
  --    window where the account is half-deleted but still able to sign in.
  --    (Avatar storage objects are removed client-side beforehand; the
  --    platform rejects DELETE on storage.objects from SQL.)
  IF v_auth IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth;
  END IF;

  RETURN jsonb_build_object(
    'status','completed',
    'request_id', v_req_id,
    'future_hosted_meetup_count', v_hosted,
    'future_attendance_count', v_attending
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
REVOKE ALL ON FUNCTION public.get_veggie_profile_availability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_veggie_profile_availability(uuid) TO authenticated;