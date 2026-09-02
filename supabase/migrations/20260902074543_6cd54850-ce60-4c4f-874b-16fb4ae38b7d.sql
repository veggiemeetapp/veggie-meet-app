-- WO-144 — Multi-select Veggie Network Meetup invitations.

-- 1. Invitations may exist without a DM conversation (host network invites).
ALTER TABLE public.meetup_invitations ALTER COLUMN conversation_id DROP NOT NULL;

-- 2. One invitation per (meetup, recipient) regardless of sender.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.meetup_invitations
    GROUP BY meetup_id, recipient_id HAVING count(*) > 1
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'meetup_invitations_meetup_recipient_uniq'
  ) THEN
    CREATE UNIQUE INDEX meetup_invitations_meetup_recipient_uniq
      ON public.meetup_invitations (meetup_id, recipient_id);
  END IF;
END;
$$;

-- 3. Trigger: only validate the conversation when one is supplied.
CREATE OR REPLACE FUNCTION public.enforce_meetup_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE m RECORD; conv RECORD; attending_recipient boolean; attendee_count int; sender_attending boolean;
BEGIN
  SELECT id, host_id, status, date, start_time, capacity, timezone
    INTO m FROM public.meetups WHERE id = NEW.meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status <> 'upcoming' THEN
    RAISE EXCEPTION 'Meetup is no longer accepting invitations';
  END IF;
  IF public.meetup_start_at(m.date, m.start_time, m.timezone) < now() THEN
    RAISE EXCEPTION 'Meetup has already started';
  END IF;

  IF NOT public.profile_is_eligible(NEW.sender_id)
     OR NOT public.profile_is_eligible(NEW.recipient_id) THEN
    RAISE EXCEPTION 'This Veggie is unavailable.';
  END IF;

  IF m.host_id = NEW.sender_id THEN
    sender_attending := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.attendance
      WHERE profile_id = NEW.sender_id AND meetup_id = NEW.meetup_id
        AND status::text NOT IN ('cancelled','removed')
    ) INTO sender_attending;
  END IF;
  IF NOT sender_attending THEN
    RAISE EXCEPTION 'You must be hosting or attending this Meetup to invite';
  END IF;

  IF NOT public.are_connected(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'You can only invite connected Veggies';
  END IF;
  IF public.is_blocked_between(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = NEW.recipient_id AND meetup_id = NEW.meetup_id
      AND status::text NOT IN ('cancelled','removed')
  ) INTO attending_recipient;
  IF attending_recipient THEN
    RAISE EXCEPTION 'Recipient is already attending';
  END IF;

  SELECT count(*) INTO attendee_count FROM public.attendance
    WHERE meetup_id = NEW.meetup_id AND status::text NOT IN ('cancelled','removed');
  IF attendee_count >= m.capacity THEN
    RAISE EXCEPTION 'Meetup is full';
  END IF;

  -- WO-144: host network invitations carry no conversation.
  IF NEW.conversation_id IS NOT NULL THEN
    SELECT user_a_id, user_b_id INTO conv FROM public.dm_conversations WHERE id = NEW.conversation_id;
    IF conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
    IF NOT ((conv.user_a_id = NEW.sender_id AND conv.user_b_id = NEW.recipient_id)
         OR (conv.user_a_id = NEW.recipient_id AND conv.user_b_id = NEW.sender_id)) THEN
      RAISE EXCEPTION 'Conversation does not match sender/recipient';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Notifications route to the Meetup when there is no conversation.
CREATE OR REPLACE FUNCTION public.handle_invitation_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  recipient_name text;
  meetup_title text;
  dest_type text;
  dest_id uuid;
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    dest_type := 'dm_conversation';
    dest_id := NEW.conversation_id;
  ELSE
    dest_type := 'meetup';
    dest_id := NEW.meetup_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
    SELECT title INTO meetup_title FROM public.meetups WHERE id = NEW.meetup_id;
    PERFORM public._insert_notification(
      NEW.recipient_id, NEW.sender_id, 'meetup_invitation_received',
      'meetup_invitation', NEW.id,
      dest_type, dest_id,
      NULL,
      COALESCE(NULLIF(sender_name,''),'Someone') || ' invited you to ' || COALESCE(meetup_title,'a Meetup') || '.',
      jsonb_build_object('invitation_id', NEW.id, 'meetup_id', NEW.meetup_id, 'conversation_id', NEW.conversation_id),
      'invitation:' || NEW.id::text || ':received'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = 'joined'
     AND OLD.status IS DISTINCT FROM 'joined' THEN
    SELECT display_name INTO recipient_name FROM public.profiles WHERE id = NEW.recipient_id;
    SELECT title INTO meetup_title FROM public.meetups WHERE id = NEW.meetup_id;
    PERFORM public._insert_notification(
      NEW.sender_id, NEW.recipient_id, 'meetup_invitation_joined',
      'meetup_invitation', NEW.id,
      dest_type, dest_id,
      NULL,
      COALESCE(NULLIF(recipient_name,''),'Someone') || ' joined ' || COALESCE(meetup_title,'the Meetup') || ' from your invitation.',
      jsonb_build_object('invitation_id', NEW.id, 'meetup_id', NEW.meetup_id, 'conversation_id', NEW.conversation_id),
      'invitation:' || NEW.id::text || ':joined'
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Candidate list for the host invite sheet.
CREATE OR REPLACE FUNCTION public.get_meetup_invite_candidates(_meetup_id uuid)
RETURNS TABLE (
  profile_id uuid,
  display_name text,
  first_name text,
  avatar_url text,
  city_name text,
  already_attending boolean,
  already_invited boolean,
  invitation_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meetups WHERE id = _meetup_id AND host_id = me) THEN
    RAISE EXCEPTION 'Only the host can invite Veggies to this Meetup';
  END IF;

  RETURN QUERY
  WITH connections AS (
    SELECT CASE WHEN f.requester_id = me THEN f.addressee_id ELSE f.requester_id END AS other_id
    FROM public.friendships f
    WHERE (f.requester_id = me OR f.addressee_id = me)
      AND f.status::text IN ('connected','verified')
  )
  SELECT
    p.id,
    p.display_name,
    COALESCE(NULLIF(split_part(p.display_name, ' ', 1), ''), p.display_name),
    p.avatar_url,
    c.name,
    EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.meetup_id = _meetup_id AND a.profile_id = p.id
        AND a.status::text NOT IN ('cancelled','removed')
    ),
    inv.id IS NOT NULL,
    inv.status::text
  FROM connections k
  JOIN public.profiles p ON p.id = k.other_id
  LEFT JOIN public.cities c ON c.id = p.home_city_id
  LEFT JOIN public.meetup_invitations inv
         ON inv.meetup_id = _meetup_id AND inv.recipient_id = p.id
  WHERE p.deleted_at IS NULL
    AND NOT public.is_blocked_between(me, p.id)
  ORDER BY p.display_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_meetup_invite_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meetup_invite_candidates(uuid) TO authenticated;

-- 6. Batch send. Idempotent, concurrency-safe, per-recipient skip reasons.
CREATE OR REPLACE FUNCTION public.send_meetup_invitations(
  _meetup_id uuid,
  _recipient_ids uuid[],
  _personal_message text DEFAULT NULL
)
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
  sent_today int;
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
  IF array_length(ids, 1) > 20 THEN
    RAISE EXCEPTION 'You can invite up to 20 Veggies at a time.';
  END IF;

  clean_msg := COALESCE(btrim(_personal_message), '');
  IF char_length(clean_msg) > 300 THEN RAISE EXCEPTION 'Message too long'; END IF;
  IF clean_msg = '' THEN clean_msg := 'Want to join me for this Meetup?'; END IF;

  -- Daily abuse cap per sender.
  SELECT count(*) INTO sent_today FROM public.meetup_invitations
    WHERE sender_id = me AND created_at > now() - interval '24 hours';
  IF sent_today + array_length(ids, 1) > 200 THEN
    RAISE EXCEPTION 'You have reached the daily invitation limit. Please try again tomorrow.';
  END IF;

  -- Serialise concurrent sends for this meetup.
  PERFORM pg_advisory_xact_lock(hashtext('meetup_invite:' || _meetup_id::text));

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

      INSERT INTO public.meetup_invitations
        (meetup_id, sender_id, recipient_id, conversation_id, personal_message)
      VALUES (_meetup_id, me, rid, NULL, clean_msg)
      RETURNING id INTO new_id;
      invited := invited || new_id;
    EXCEPTION
      WHEN unique_violation THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'already_invited');
      WHEN others THEN
        skipped := skipped || jsonb_build_object('profile_id', rid, 'reason', 'blocked');
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'meetup_id', _meetup_id,
    'invited_count', COALESCE(array_length(invited, 1), 0),
    'invitation_ids', to_jsonb(invited),
    'skipped', skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_meetup_invitations(uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_meetup_invitations(uuid, uuid[], text) TO authenticated;

-- 7. Analytics vocabulary additions.
CREATE OR REPLACE FUNCTION public.analytics_event_allowed(_event_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT _event_name IN (
    'today_opened','community_home_opened','notifications_opened','you_opened',
    'account_deletion_blocked','account_deletion_completed','account_deletion_started',
    'auth_signin_success','auth_signup_started','auth_signup_success',
    'check_in_started_from_plans','community_impact_place_count_updated',
    'community_place_card_opened','community_place_check_in_failed',
    'community_place_check_in_started','community_place_check_in_succeeded',
    'community_place_detail_opened','community_place_directions_opened',
    'community_place_edit_blocked','community_place_edit_completed',
    'community_place_edit_google_checked','community_place_edit_opened',
    'community_place_edit_previewed','community_place_host_started',
    'community_place_identity_review_blocked','community_place_identity_review_cancelled',
    'community_place_identity_review_completed','community_place_identity_review_opened',
    'community_place_identity_review_started','community_place_meetup_opened',
    'community_place_operations_activity_loaded_more',
    'community_place_operations_attention_opened',
    'community_place_operations_filter_changed','community_place_operations_place_opened',
    'community_place_report_blocked','community_place_report_history_opened',
    'community_place_report_moderated','community_place_report_notification_opened',
    'community_place_report_owner_opened','community_place_report_started',
    'community_place_report_submitted','community_place_reverification_cancelled',
    'community_place_reverification_completed','community_place_reverification_queue_opened',
    'community_place_reverification_started','community_place_shared',
    'community_place_suggestion_failed','community_place_suggestion_owner_opened',
    'community_place_suggestion_promoted','community_place_suggestion_started',
    'community_place_suggestion_submitted','community_place_vegan_review_blocked',
    'community_place_vegan_review_cancelled','community_place_vegan_review_completed',
    'community_place_vegan_review_opened','community_place_vegan_review_started',
    'community_places_filter_changed','community_places_opened',
    'discovery_settings_saved','error_boundary_activated',
    'location_permission_result','meetup_check_in_blocked','meetup_check_in_completed',
    'meetup_check_in_started','meetup_community_place_opened',
    'meetup_community_place_selected','meetup_community_place_viewed',
    'meetup_completion_blocked','meetup_completion_completed','meetup_completion_started',
    'meetup_created','meetup_created_at_community_place','meetup_left_from_plans',
    'meetup_location_change_notification_opened','meetup_location_mode_selected',
    'meetup_location_review_opened','meetup_location_update_blocked',
    'meetup_location_update_completed','meetup_location_update_started',
    'member_blocked','member_reported','my_plans_opened',
    'notification_preference_changed','notification_permission_result',
    'offline_detected','onboarding_completed','onboarding_starting_action_chosen',
    'onboarding_step_completed','onboarding_step_viewed',
    'place_suggestion_history_opened','place_suggestion_notification_created',
    'place_suggestion_notification_opened','plan_opened','profile_visibility_changed',
    'reconnect_completed','request_failed','settings_opened','settings_profile_updated',
    'sign_out_completed','supported_place_card_opened','supported_places_explore_clicked',
    'supported_places_opened',
    'op_read_failed','op_mutation_failed','op_auth_failed','op_realtime_failed',
    'op_deeplink_failed','op_app_boot_failed',
    'beta_feedback_opened','beta_feedback_submitted','beta_feedback_failed',
    'owner_beta_operations_opened','owner_beta_feedback_status_updated',
    'owner_community_place_operations_opened',
    'follow_up_prompt_shown','follow_up_opened','follow_up_dismissed',
    'host_opened','meet_next_opened','network_opened',
    'connection_request_sent','connection_request_accepted','meetup_joined',
    'auth_password_reset_requested','auth_password_reset_success',
    'auth_password_reset_failed','auth_signin_failed',
    'today_place_curation_opened','today_place_featured','today_place_unfeatured',
    'today_place_hidden','today_place_restored','today_place_reordered',
    'meetup_add_to_calendar',
    -- WO-144 multi-select Veggie Network invitations
    'meetup_invite_sheet_opened','meetup_invitations_sent','meetup_invitations_failed'
  );
$function$;