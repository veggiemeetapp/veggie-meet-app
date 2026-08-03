-- Map the new suggestion notification kinds onto the existing "community" preference.
CREATE OR REPLACE FUNCTION public._insert_notification(_recipient uuid, _actor uuid, _type notification_type, _entity_type text, _entity_id uuid, _destination_type text, _destination_id uuid, _title text, _body text, _metadata jsonb, _dedup_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref_col text;
  v_enabled boolean;
BEGIN
  IF _actor IS NOT NULL AND _actor = _recipient THEN RETURN; END IF;
  IF _recipient IS NULL THEN RETURN; END IF;

  v_pref_col := CASE _type
    WHEN 'connection_request_received' THEN 'connection_requests'
    WHEN 'connection_request_accepted' THEN 'connection_accepted'
    WHEN 'meetup_invitation_received'  THEN 'meetup_invitations'
    WHEN 'meetup_invitation_joined'    THEN 'meetup_invitations'
    WHEN 'meetup_updated'              THEN 'meetup_updates'
    WHEN 'meetup_cancelled'            THEN 'meetup_updates'
    WHEN 'meetup_attendee_removed'     THEN 'meetup_updates'
    WHEN 'place_suggestion_under_review' THEN 'community'
    WHEN 'place_suggestion_approved'     THEN 'community'
    WHEN 'place_suggestion_duplicate'    THEN 'community'
    WHEN 'place_suggestion_rejected'     THEN 'community'
    ELSE NULL
  END;

  IF v_pref_col IS NOT NULL THEN
    EXECUTE format(
      'SELECT COALESCE((SELECT %I FROM public.notification_preferences WHERE profile_id = $1), TRUE)',
      v_pref_col
    ) INTO v_enabled USING _recipient;
    IF v_enabled IS FALSE THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, actor_id, type, entity_type, entity_id,
    destination_type, destination_id, title, body, metadata, dedup_key
  ) VALUES (
    _recipient, _actor, _type, _entity_type, _entity_id,
    _destination_type, _destination_id, _title, _body, COALESCE(_metadata,'{}'::jsonb), _dedup_key
  )
  ON CONFLICT (recipient_id, dedup_key) DO NOTHING;
END;
$function$;

-- Server-authoritative, privacy-safe notifier for suggestion status changes.
CREATE OR REPLACE FUNCTION public._notify_place_suggestion(_suggestion_id uuid, _recipient uuid, _place_name text, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_type notification_type;
  v_title text;
  v_body text;
BEGIN
  IF _recipient IS NULL THEN RETURN; END IF;
  v_name := left(coalesce(nullif(btrim(_place_name), ''), 'Your suggested place'), 80);

  IF _status = 'under_review' THEN
    v_type := 'place_suggestion_under_review';
    v_title := 'We''re reviewing your place suggestion';
    v_body := v_name || ' is now being reviewed by the VeggieMeet team.';
  ELSIF _status = 'approved' THEN
    v_type := 'place_suggestion_approved';
    v_title := 'Your place suggestion moved forward';
    v_body := v_name || ' has been added to our private verification queue.';
  ELSIF _status = 'duplicate' THEN
    v_type := 'place_suggestion_duplicate';
    v_title := 'This place was already suggested';
    v_body := 'We already have ' || v_name || ' in our review process.';
  ELSIF _status = 'rejected' THEN
    v_type := 'place_suggestion_rejected';
    v_title := 'Your place suggestion wasn''t approved';
    v_body := v_name || ' does not currently meet the requirements for Community Places.';
  ELSE
    RETURN;
  END IF;

  PERFORM public._insert_notification(
    _recipient,
    NULL,                       -- never expose reviewer identity
    v_type,
    'place_suggestion',
    _suggestion_id,
    'place_suggestion',
    _suggestion_id,
    v_title,
    v_body,
    jsonb_build_object('place_name', v_name),
    'place_suggestion:' || _suggestion_id::text || ':' || _status
  );
END;
$$;

REVOKE ALL ON FUNCTION public._notify_place_suggestion(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._notify_place_suggestion(uuid, uuid, text, text) TO service_role;

-- Moderation: status change + notification in one transaction.
CREATE OR REPLACE FUNCTION public.moderate_place_suggestion(_suggestion_id uuid, _action text, _reason text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; s record; next_status text;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  me := public.current_profile_id();

  SELECT * INTO s FROM public.community_place_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF s.moderation_status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promoted');
  END IF;

  IF _action = 'start_review' THEN next_status := 'under_review';
  ELSIF _action = 'reject' THEN
    IF _reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_required'); END IF;
    next_status := 'rejected';
  ELSIF _action = 'duplicate' THEN next_status := 'duplicate';
  ELSE RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;

  UPDATE public.community_place_suggestions
     SET moderation_status = next_status,
         rejection_reason = CASE WHEN next_status = 'rejected' THEN _reason ELSE rejection_reason END,
         moderation_notes = coalesce(_notes, moderation_notes),
         reviewed_at = now(),
         reviewed_by = me
   WHERE id = _suggestion_id;

  PERFORM public._notify_place_suggestion(s.id, s.submitted_by, s.place_name, next_status);

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'status', next_status, 'notified', true);
END; $function$;

CREATE OR REPLACE FUNCTION public.promote_place_suggestion_to_candidate(_suggestion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; s record; cand_id uuid;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  me := public.current_profile_id();

  SELECT * INTO s FROM public.community_place_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF s.promoted_candidate_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promoted');
  END IF;
  IF s.moderation_status NOT IN ('pending','under_review') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  INSERT INTO public.place_candidates (
    display_name, district, city_id, source, verification_status,
    veggie_reason, verification_notes, image_rights_status, created_by
  ) VALUES (
    s.place_name, s.address_text, s.city_id, 'community_submitted', 'draft',
    s.vegan_reason,
    'Promoted from community suggestion ' || s.id::text
      || coalesce(E'\nSubmitter note: ' || s.submitter_note, '')
      || E'\nOfficial source: ' || s.official_source_url,
    'none', me
  ) RETURNING id INTO cand_id;

  UPDATE public.community_place_suggestions
     SET moderation_status = 'approved',
         promoted_candidate_id = cand_id,
         reviewed_at = now(),
         reviewed_by = me
   WHERE id = _suggestion_id;

  PERFORM public._notify_place_suggestion(s.id, s.submitted_by, s.place_name, 'approved');

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'candidate_id', cand_id, 'notified', true);
END; $function$;