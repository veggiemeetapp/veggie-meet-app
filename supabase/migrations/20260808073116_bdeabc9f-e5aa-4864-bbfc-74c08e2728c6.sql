-- WO-068 Member Blocking, Reporting & Safety Integrity

-- 1. Pair-block probe (caller-scoped only; never reveals direction)
CREATE OR REPLACE FUNCTION public.is_pair_blocked(_other_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL OR _other_profile_id IS NULL OR me = _other_profile_id THEN RETURN false; END IF;
  RETURN public.is_blocked_between(me, _other_profile_id);
END; $$;
REVOKE ALL ON FUNCTION public.is_pair_blocked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pair_blocked(uuid) TO authenticated;

-- 2. block_profile: idempotent + transactional side effects
DROP FUNCTION IF EXISTS public.block_profile(uuid);
CREATE OR REPLACE FUNCTION public.block_profile(_blocked_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid; row_id uuid; existed boolean := false;
  n_req int := 0; n_inv int := 0; n_att int := 0;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _blocked_profile_id IS NULL OR _blocked_profile_id = me THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _blocked_profile_id) THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;

  SELECT id INTO row_id FROM public.user_blocks
   WHERE blocker_profile_id = me AND blocked_profile_id = _blocked_profile_id;
  IF row_id IS NOT NULL THEN
    RETURN jsonb_build_object('result','already_blocked','block_id',row_id);
  END IF;

  INSERT INTO public.user_blocks (blocker_profile_id, blocked_profile_id)
    VALUES (me, _blocked_profile_id)
    ON CONFLICT (blocker_profile_id, blocked_profile_id) DO NOTHING
    RETURNING id INTO row_id;
  IF row_id IS NULL THEN
    SELECT id INTO row_id FROM public.user_blocks
     WHERE blocker_profile_id = me AND blocked_profile_id = _blocked_profile_id;
    existed := true;
  END IF;

  -- Neutralize pending connection requests in either direction (history: removed)
  WITH upd AS (
    UPDATE public.friendships
       SET status = 'removed'::friendship_status, updated_at = now()
     WHERE profile_a_id = LEAST(me,_blocked_profile_id)
       AND profile_b_id = GREATEST(me,_blocked_profile_id)
       AND status = 'pending'::friendship_status
     RETURNING 1
  ) SELECT count(*) INTO n_req FROM upd;

  -- Neutralize pending Meetup invitations in either direction
  WITH upd AS (
    UPDATE public.meetup_invitations
       SET status = 'declined'::invitation_status, updated_at = now()
     WHERE status IN ('invited'::invitation_status,'viewed'::invitation_status)
       AND ((sender_id = me AND recipient_id = _blocked_profile_id)
         OR (sender_id = _blocked_profile_id AND recipient_id = me))
     RETURNING 1
  ) SELECT count(*) INTO n_inv FROM upd;

  -- Remove the non-host member from UPCOMING meetups hosted by the other member.
  -- Only 'joined' attendance is touched: checked-in / attended / completed history is never rewritten.
  WITH upd AS (
    UPDATE public.attendance a
       SET status = 'cancelled'::attendance_status, updated_at = now()
     WHERE a.status = 'joined'::attendance_status
       AND EXISTS (
         SELECT 1 FROM public.meetups m
          WHERE m.id = a.meetup_id
            AND m.status NOT IN ('past'::meetup_status,'cancelled'::meetup_status)
            AND m.date >= CURRENT_DATE
            AND NOT EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = m.id)
            AND ((m.host_id = me AND a.profile_id = _blocked_profile_id)
              OR (m.host_id = _blocked_profile_id AND a.profile_id = me))
       )
     RETURNING 1
  ) SELECT count(*) INTO n_att FROM upd;

  RETURN jsonb_build_object(
    'result', CASE WHEN existed THEN 'already_blocked' ELSE 'blocked' END,
    'block_id', row_id,
    'neutralized_requests', n_req,
    'neutralized_invitations', n_inv,
    'cancelled_attendance', n_att
  );
END; $$;
REVOKE ALL ON FUNCTION public.block_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_profile(uuid) TO authenticated;

-- 3. unblock_profile: no automatic reconnection / no side effects
DROP FUNCTION IF EXISTS public.unblock_profile(uuid);
CREATE OR REPLACE FUNCTION public.unblock_profile(_blocked_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; n int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  WITH del AS (
    DELETE FROM public.user_blocks
     WHERE blocker_profile_id = me AND blocked_profile_id = _blocked_profile_id
     RETURNING 1
  ) SELECT count(*) INTO n FROM del;
  RETURN jsonb_build_object('result', CASE WHEN n > 0 THEN 'unblocked' ELSE 'not_blocked' END);
END; $$;
REVOKE ALL ON FUNCTION public.unblock_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unblock_profile(uuid) TO authenticated;

-- 4. Notification suppression between blocked pairs
CREATE OR REPLACE FUNCTION public._insert_notification(
  _recipient uuid, _actor uuid, _type notification_type, _entity_type text, _entity_id uuid,
  _destination_type text, _destination_id uuid, _title text, _body text, _metadata jsonb, _dedup_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pref_col text;
  v_enabled boolean;
BEGIN
  IF _actor IS NOT NULL AND _actor = _recipient THEN RETURN; END IF;
  IF _recipient IS NULL THEN RETURN; END IF;
  IF _actor IS NOT NULL AND public.is_blocked_between(_actor, _recipient) THEN RETURN; END IF;

  v_pref_col := CASE _type
    WHEN 'connection_request_received' THEN 'connection_requests'
    WHEN 'connection_request_accepted' THEN 'connection_accepted'
    WHEN 'meetup_invitation_received'  THEN 'meetup_invitations'
    WHEN 'meetup_invitation_joined'    THEN 'meetup_invitations'
    WHEN 'meetup_updated'              THEN 'meetup_updates'
    WHEN 'meetup_cancelled'            THEN 'meetup_updates'
    WHEN 'meetup_attendee_removed'     THEN 'meetup_updates'
    WHEN 'meetup_location_changed'     THEN 'meetup_updates'
    WHEN 'meetup_location_needs_attention' THEN 'meetup_updates'
    WHEN 'place_suggestion_under_review' THEN 'community'
    WHEN 'place_suggestion_approved'     THEN 'community'
    WHEN 'place_suggestion_duplicate'    THEN 'community'
    WHEN 'place_suggestion_rejected'     THEN 'community'
    WHEN 'community_place_report_under_review' THEN 'community'
    WHEN 'community_place_report_resolved'     THEN 'community'
    WHEN 'community_place_report_dismissed'    THEN 'community'
    WHEN 'community_place_report_duplicate'    THEN 'community'
    ELSE NULL
  END;

  IF v_pref_col IS NOT NULL THEN
    EXECUTE format(
      'SELECT COALESCE((SELECT %I FROM public.notification_preferences WHERE profile_id = $1), TRUE)',
      v_pref_col
    ) INTO v_enabled USING _recipient;
    IF v_enabled IS FALSE THEN RETURN; END IF;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, actor_id, type, entity_type, entity_id,
    destination_type, destination_id, title, body, metadata, dedup_key
  ) VALUES (
    _recipient, _actor, _type, _entity_type, _entity_id,
    _destination_type, _destination_id, _title, _body, COALESCE(_metadata,'{}'::jsonb), _dedup_key
  )
  ON CONFLICT (recipient_id, dedup_key) DO NOTHING;
END; $$;

-- 5. Meetup join blocked when host pair is blocked (neutral message)
CREATE OR REPLACE FUNCTION public.join_meetup(_meetup_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid; existing_id uuid; new_id uuid; prior_status text; m RECORD; active_count int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO existing_id FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
      AND status::text NOT IN ('cancelled','removed') LIMIT 1;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  SELECT status::text INTO prior_status FROM public.attendance
    WHERE profile_id = me AND meetup_id = _meetup_id
    ORDER BY updated_at DESC LIMIT 1;
  IF prior_status = 'removed' THEN
    RAISE EXCEPTION 'You can''t rejoin this Meetup.';
  END IF;

  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = _meetup_id FOR UPDATE;

  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;

  IF m.host_id <> me AND public.is_blocked_between(me, m.host_id) THEN
    RAISE EXCEPTION 'This Meetup isn''t available to join.';
  END IF;

  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has been cancelled.';
  END IF;
  IF m.status IN ('past'::meetup_status, 'in_progress'::meetup_status) THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;
  IF ((m.date::timestamp + m.start_time) AT TIME ZONE COALESCE(m.timezone, 'UTC')) < now() THEN
    RAISE EXCEPTION 'This Meetup has already started.';
  END IF;

  IF m.host_id <> me THEN
    SELECT count(*) INTO active_count FROM public.attendance a
      WHERE a.meetup_id = _meetup_id AND a.status::text NOT IN ('cancelled','removed');
    IF active_count >= m.capacity THEN
      RAISE EXCEPTION 'This Meetup is full.';
    END IF;
  END IF;

  UPDATE public.attendance
     SET status = 'joined'::attendance_status, joined_at = now()
   WHERE profile_id = me AND meetup_id = _meetup_id AND status = 'cancelled'::attendance_status
   RETURNING id INTO new_id;
  IF new_id IS NOT NULL THEN RETURN new_id; END IF;

  INSERT INTO public.attendance (profile_id, meetup_id, status)
    VALUES (me, _meetup_id, 'joined'::attendance_status)
    RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.join_meetup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_meetup(uuid) TO authenticated;

-- 6. Check-in blocked when host pair is blocked
CREATE OR REPLACE FUNCTION public.check_in_to_meetup(_meetup_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; att RECORD; win text; completed boolean; host uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _meetup_id IS NULL THEN RETURN jsonb_build_object('result','blocked','reason','invalid'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.meetup_completions c WHERE c.meetup_id = _meetup_id)
    INTO completed;
  IF completed THEN
    RETURN jsonb_build_object('result','blocked','reason','completed');
  END IF;

  SELECT host_id INTO host FROM public.meetups WHERE id = _meetup_id;
  IF host IS NOT NULL AND host <> me AND public.is_blocked_between(me, host) THEN
    RETURN jsonb_build_object('result','blocked','reason','unavailable');
  END IF;

  SELECT * INTO att FROM public.attendance a
    WHERE a.meetup_id = _meetup_id AND a.profile_id = me
    ORDER BY a.updated_at DESC LIMIT 1
    FOR UPDATE;

  IF att.id IS NULL OR att.status::text IN ('cancelled') THEN
    RETURN jsonb_build_object('result','blocked','reason','not_joined');
  END IF;
  IF att.status::text = 'removed' THEN
    RETURN jsonb_build_object('result','blocked','reason','removed');
  END IF;
  IF att.status::text IN ('checked_in','attended') THEN
    RETURN jsonb_build_object('result','already_checked_in','checked_in_at',att.checked_in_at);
  END IF;

  win := public.meetup_in_check_in_window(_meetup_id);
  IF win <> 'open' THEN
    RETURN jsonb_build_object('result','blocked','reason',
      CASE win WHEN 'missing' THEN 'invalid' ELSE win END);
  END IF;

  PERFORM set_config('app.attendance_checkin','1', true);
  UPDATE public.attendance
     SET status = 'checked_in'::attendance_status,
         checked_in_at = COALESCE(checked_in_at, now()),
         updated_at = now()
   WHERE id = att.id;

  RETURN jsonb_build_object('result','checked_in','checked_in_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.check_in_to_meetup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_to_meetup(uuid) TO authenticated;

-- 7. Meetup invitations blocked between blocked pairs
CREATE OR REPLACE FUNCTION public.create_meetup_invitation(_meetup_id uuid, _recipient_id uuid, _personal_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; conv_id uuid; invitation_id uuid; existing_id uuid; clean_msg text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _recipient_id = me THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF public.is_blocked_between(me, _recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;

  clean_msg := COALESCE(btrim(_personal_message), '');
  IF char_length(clean_msg) > 300 THEN RAISE EXCEPTION 'Message too long'; END IF;
  IF clean_msg = '' THEN clean_msg := 'Want to join me for this Meetup?'; END IF;

  SELECT id INTO existing_id FROM public.meetup_invitations
    WHERE meetup_id = _meetup_id AND sender_id = me AND recipient_id = _recipient_id;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'You already invited this Veggie to this Meetup';
  END IF;

  conv_id := public.get_or_create_dm(_recipient_id);

  INSERT INTO public.meetup_invitations
    (meetup_id, sender_id, recipient_id, conversation_id, personal_message)
  VALUES (_meetup_id, me, _recipient_id, conv_id, clean_msg)
  RETURNING id INTO invitation_id;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body, invitation_id)
  VALUES (conv_id, me, clean_msg, invitation_id);

  RETURN invitation_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_meetup_invitation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_meetup_invitation(uuid, uuid, text) TO authenticated;

-- 8. Member report: rate limit + de-duplication
CREATE OR REPLACE FUNCTION public.submit_profile_report(
  _reported_profile_id uuid, _reason text, _details text, _conversation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; row_id uuid; clean_reason text; clean_details text; recent int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _reported_profile_id IS NULL OR _reported_profile_id = me THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _reported_profile_id) THEN
    RAISE EXCEPTION 'Invalid target';
  END IF;

  clean_reason := NULLIF(btrim(COALESCE(_reason,'')),'');
  IF clean_reason IS NULL OR char_length(clean_reason) > 80 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  clean_details := NULLIF(btrim(COALESCE(_details,'')),'');
  IF clean_details IS NOT NULL AND char_length(clean_details) > 1000 THEN
    RAISE EXCEPTION 'Details too long';
  END IF;

  -- De-duplicate: same target within 24h reuses the open report
  SELECT id INTO row_id FROM public.user_reports
   WHERE reporter_profile_id = me
     AND reported_profile_id = _reported_profile_id
     AND created_at > now() - interval '24 hours'
   ORDER BY created_at DESC LIMIT 1;
  IF row_id IS NOT NULL THEN RETURN row_id; END IF;

  SELECT count(*) INTO recent FROM public.user_reports
   WHERE reporter_profile_id = me AND created_at > now() - interval '24 hours';
  IF recent >= 10 THEN
    RAISE EXCEPTION 'You''ve submitted a lot of reports today. Please try again later.';
  END IF;

  INSERT INTO public.user_reports (reporter_profile_id, reported_profile_id, conversation_id, reason, details)
    VALUES (me, _reported_profile_id, _conversation_id, clean_reason, clean_details)
    RETURNING id INTO row_id;
  RETURN row_id;
END; $$;
REVOKE ALL ON FUNCTION public.submit_profile_report(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_profile_report(uuid, text, text, uuid) TO authenticated;

-- 9. Explicit combined report + block (single transaction)
CREATE OR REPLACE FUNCTION public.report_and_block_profile(
  _reported_profile_id uuid, _reason text, _details text, _conversation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rep uuid; blk jsonb;
BEGIN
  rep := public.submit_profile_report(_reported_profile_id, _reason, _details, _conversation_id);
  blk := public.block_profile(_reported_profile_id);
  RETURN jsonb_build_object('report_id', rep, 'block', blk);
END; $$;
REVOKE ALL ON FUNCTION public.report_and_block_profile(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_and_block_profile(uuid, text, text, uuid) TO authenticated;

-- 10. Owner-only member report queue
CREATE OR REPLACE FUNCTION public.get_member_report_queue(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'counts', (SELECT jsonb_build_object(
        'submitted', count(*) FILTER (WHERE status = 'submitted'),
        'under_review', count(*) FILTER (WHERE status = 'under_review'),
        'resolved', count(*) FILTER (WHERE status = 'resolved'),
        'dismissed', count(*) FILTER (WHERE status = 'dismissed'),
        'total', count(*)) FROM public.user_reports),
    'items', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
        SELECT jsonb_build_object(
          'report_id', r.id,
          'status', r.status,
          'reason', r.reason,
          'details', r.details,
          'created_at', r.created_at,
          'resolved_at', r.resolved_at,
          'reporter', jsonb_build_object('profile_id', rp.id, 'display_name', rp.display_name),
          'reported', jsonb_build_object('profile_id', tp.id, 'display_name', tp.display_name),
          'has_conversation', r.conversation_id IS NOT NULL,
          'message_snapshot', r.reported_message_snapshot
        ) AS x
        FROM public.user_reports r
        JOIN public.profiles rp ON rp.id = r.reporter_profile_id
        JOIN public.profiles tp ON tp.id = r.reported_profile_id
        WHERE _status IS NULL OR r.status = _status
        ORDER BY r.created_at DESC
        LIMIT 100
      ) s), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_member_report_queue(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_report_queue(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_member_report_status(_report_id uuid, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _status NOT IN ('submitted','under_review','resolved','dismissed') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  WITH upd AS (
    UPDATE public.user_reports
       SET status = _status,
           updated_at = now(),
           resolved_at = CASE WHEN _status IN ('resolved','dismissed') THEN now() ELSE NULL END
     WHERE id = _report_id
     RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  IF n = 0 THEN RAISE EXCEPTION 'Report not found'; END IF;
  RETURN jsonb_build_object('result','updated','status',_status);
END; $$;
REVOKE ALL ON FUNCTION public.set_member_report_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_report_status(uuid, text) TO authenticated;