CREATE OR REPLACE FUNCTION public.send_meetup_invitations(_meetup_id uuid, _recipient_ids uuid[], _personal_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  m RECORD;
  ids uuid[];
  rid uuid;
  clean_msg text;
  used int;
  window_start timestamptz;
  daily_limit constant int := 50;
  batch_limit constant int := 20;
  invited uuid[] := '{}';
  skipped jsonb := '[]'::jsonb;
  new_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = _meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.host_id <> me THEN
    RAISE EXCEPTION 'Only the host can invite Veggies to this Meetup';
  END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This Meetup has been cancelled.';
  END IF;
  IF m.status <> 'upcoming'::meetup_status
     OR public.meetup_start_at(m.date, m.start_time, m.timezone) < now() THEN
    RAISE EXCEPTION 'This Meetup is no longer accepting invitations.';
  END IF;

  SELECT array_agg(DISTINCT x) INTO ids
    FROM unnest(COALESCE(_recipient_ids, '{}'::uuid[])) AS t(x)
   WHERE x IS NOT NULL AND x <> me;
  ids := COALESCE(ids, '{}'::uuid[]);

  IF array_length(ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one Veggie to invite.';
  END IF;
  IF array_length(ids, 1) > batch_limit THEN
    RAISE EXCEPTION 'You can invite up to 20 Veggies at a time.';
  END IF;

  clean_msg := COALESCE(btrim(_personal_message), '');
  IF char_length(clean_msg) > 300 THEN RAISE EXCEPTION 'Message too long'; END IF;
  IF clean_msg = '' THEN clean_msg := 'Want to join me for this Meetup?'; END IF;

  -- WO-144B: sender-scoped quota lock is always taken BEFORE the meetup-scoped
  -- lock, giving every caller one global ordering (quota class then meetup
  -- class), so concurrent batches cannot deadlock and cannot race the sender's
  -- rolling allowance across different Meetups.
  PERFORM pg_advisory_xact_lock(hashtext('meetup_invite_quota:' || me::text));
  PERFORM pg_advisory_xact_lock(hashtext('meetup_invite:' || _meetup_id::text));

  -- Rolling window: trailing 24 hours ending at the current statement time.
  window_start := now() - interval '24 hours';
  SELECT count(*) INTO used FROM public.meetup_invitations
    WHERE sender_id = me AND created_at >= window_start;

  FOREACH rid IN ARRAY ids LOOP
    BEGIN
      IF NOT public.profile_is_eligible(rid) THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'unavailable');
        CONTINUE;
      END IF;
      IF public.is_blocked_between(me, rid) THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'unavailable');
        CONTINUE;
      END IF;
      IF NOT public.are_connected(me, rid) THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'not_connected');
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.attendance a
        WHERE a.meetup_id = _meetup_id AND a.profile_id = rid
          AND a.status::text NOT IN ('cancelled','removed')
      ) THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'already_attending');
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.meetup_invitations i
        WHERE i.meetup_id = _meetup_id AND i.recipient_id = rid
      ) THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'already_invited');
        CONTINUE;
      END IF;

      -- Quota is charged only for invitations that are actually created.
      IF used >= daily_limit THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'rate_limited');
        CONTINUE;
      END IF;

      INSERT INTO public.meetup_invitations
        (meetup_id, sender_id, recipient_id, conversation_id, personal_message)
      VALUES (_meetup_id, me, rid, NULL, clean_msg)
      RETURNING id INTO new_id;
      invited := invited || new_id;
      used := used + 1;
    EXCEPTION
      WHEN unique_violation THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'already_invited');
      WHEN others THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'unavailable');
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'meetup_id', _meetup_id,
    'invited_count', COALESCE(array_length(invited, 1), 0),
    'invitation_ids', to_jsonb(invited),
    'skipped', skipped,
    'daily_limit', daily_limit,
    'remaining', GREATEST(daily_limit - used, 0),
    'window_hours', 24,
    'window_start', window_start
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_meetup_invitation(_meetup_id uuid, _recipient_id uuid, _personal_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; conv_id uuid; invitation_id uuid; existing_id uuid; clean_msg text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _recipient_id = me THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF NOT public.profile_is_eligible(me) OR NOT public.profile_is_eligible(_recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;
  IF public.is_blocked_between(me, _recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;

  clean_msg := COALESCE(btrim(_personal_message), '');
  IF char_length(clean_msg) > 300 THEN RAISE EXCEPTION 'Message too long'; END IF;
  IF clean_msg = '' THEN clean_msg := 'Want to join me for this Meetup?'; END IF;

  -- Same sender/meetup/quota locking order as the batch path.
  PERFORM pg_advisory_xact_lock(hashtext('meetup_invite_quota:' || me::text));
  PERFORM pg_advisory_xact_lock(hashtext('meetup_invite:' || _meetup_id::text));

  -- WO-144B: one invitation per (Meetup, recipient) regardless of which path
  -- created it, so a host batch invitation and a DM invitation cannot both
  -- exist for the same recipient. Whichever path runs first wins.
  SELECT id INTO existing_id FROM public.meetup_invitations
    WHERE meetup_id = _meetup_id AND recipient_id = _recipient_id;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'This Veggie has already been invited to this Meetup';
  END IF;

  IF (SELECT count(*) FROM public.meetup_invitations
        WHERE sender_id = me AND created_at >= now() - interval '24 hours') >= 50 THEN
    RAISE EXCEPTION 'You have reached the daily invitation limit. Please try again tomorrow.';
  END IF;

  conv_id := public.get_or_create_dm(_recipient_id);

  INSERT INTO public.meetup_invitations
    (meetup_id, sender_id, recipient_id, conversation_id, personal_message)
  VALUES (_meetup_id, me, _recipient_id, conv_id, clean_msg)
  RETURNING id INTO invitation_id;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body, invitation_id)
  VALUES (conv_id, me, clean_msg, invitation_id);

  RETURN invitation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_meetup_invitations(uuid, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_meetup_invitation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_meetup_invitations(uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_meetup_invitation(uuid, uuid, text) TO authenticated;