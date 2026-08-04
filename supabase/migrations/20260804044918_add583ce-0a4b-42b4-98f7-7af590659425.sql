-- 1) New notification type for host attention
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meetup_location_needs_attention';

-- 2) Direct place route stays readable for archived/closed verified places (read-only)
DROP POLICY IF EXISTS "Signed-in users can view verified places" ON public.community_places;
CREATE POLICY "Signed-in users can view verified places"
  ON public.community_places FOR SELECT TO authenticated
  USING (verification_status = 'verified');

-- 3) Discovery/search eligibility: published + verified + active + operational
DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO def FROM pg_proc
   WHERE proname = 'search_community_places' AND pronamespace = 'public'::regnamespace;
  IF def IS NULL THEN RAISE EXCEPTION 'search_community_places missing'; END IF;
  IF position('WHERE pl.is_active IS TRUE' IN def) = 0 THEN
    RAISE EXCEPTION 'unexpected search_community_places body';
  END IF;
  def := replace(
    def,
    'WHERE pl.is_active IS TRUE',
    'WHERE pl.is_active IS TRUE AND pl.verification_status = ''verified'' AND COALESCE(pl.maintenance_status, ''operational'') = ''operational'''
  );
  EXECUTE def;
END $do$;

-- 4) Notification preference mapping for the new type
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
    WHEN 'meetup_location_changed'     THEN 'meetup_updates'
    WHEN 'meetup_location_needs_attention' THEN 'meetup_updates'
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
END;
$function$;

-- 5) Status transitions: explicit reverification required to restore, idempotent, notifies hosts
CREATE OR REPLACE FUNCTION public.set_community_place_status(_place_id uuid, _status text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  p RECORD;
  new_active boolean;
  clean_note text;
  m RECORD;
  affected int := 0;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  IF _status IS NULL OR _status NOT IN
     ('operational','needs_reverification','temporarily_closed','permanently_closed') THEN
    RAISE EXCEPTION 'Unknown status.';
  END IF;

  clean_note := nullif(btrim(coalesce(_note, '')), '');
  IF clean_note IS NOT NULL AND length(clean_note) > 500 THEN
    RAISE EXCEPTION 'Status note must be 500 characters or fewer.';
  END IF;
  IF _status <> 'operational' AND clean_note IS NULL THEN
    RAISE EXCEPTION 'A reason note is required for this status.';
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  -- Duplicate action: no state change, no history row.
  IF COALESCE(p.maintenance_status, 'operational') = _status THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true, 'place_id', _place_id,
      'maintenance_status', _status, 'is_active', p.is_active
    );
  END IF;

  -- Restoring to operational always requires explicit reverification.
  IF _status = 'operational' THEN
    RAISE EXCEPTION 'This place can only return to operational through Mark reverified.';
  END IF;

  new_active := (_status <> 'permanently_closed');

  UPDATE public.community_places
     SET maintenance_status = _status,
         status_note        = clean_note,
         status_changed_at  = now(),
         status_changed_by  = me,
         is_active          = new_active,
         updated_at         = now()
   WHERE id = _place_id;

  INSERT INTO public.community_place_status_history (
    community_place_id, old_status, new_status, old_is_active, new_is_active,
    action, note, changed_by
  ) VALUES (
    _place_id, p.maintenance_status, _status, p.is_active, new_active,
    'status_changed', clean_note, me
  );

  -- Hosts of upcoming Meetups here get one idempotent attention notification.
  -- Meetups are never auto-cancelled or moved; attendees are not notified here.
  FOR m IN
    SELECT mt.id, mt.host_id, mt.title
      FROM public.meetups mt
     WHERE mt.community_place_id = _place_id
       AND mt.status <> 'cancelled'::meetup_status
       AND (mt.date + COALESCE(mt.end_time, mt.start_time + INTERVAL '2 hours')) > now()
  LOOP
    affected := affected + 1;
    PERFORM public._insert_notification(
      m.host_id, NULL, 'meetup_location_needs_attention'::notification_type,
      'meetup', m.id, 'meetup_management', m.id,
      'Location needs attention',
      'The Community Place for "' || m.title || '" is no longer available. Update the Meetup location.',
      jsonb_build_object('meetup_id', m.id, 'community_place_id', _place_id, 'place_status', _status),
      'place_status:' || _place_id::text || ':' || m.id::text || ':' || _status
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'place_id', _place_id,
    'maintenance_status', _status,
    'is_active', new_active,
    'affected_upcoming_meetups', affected,
    'status_changed_at', now()
  );
END; $function$;

-- 6) Reverification requires a confirmed vegan classification
CREATE OR REPLACE FUNCTION public.reverify_community_place(_place_id uuid, _note text DEFAULT NULL::text, _veggie_classification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  p RECORD;
  clean_note text;
  new_class text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  clean_note := nullif(btrim(coalesce(_note, '')), '');
  IF clean_note IS NULL THEN
    RAISE EXCEPTION 'A reverification note is required.';
  END IF;
  IF length(clean_note) > 500 THEN
    RAISE EXCEPTION 'Reverification note must be 500 characters or fewer.';
  END IF;

  new_class := nullif(btrim(coalesce(_veggie_classification, '')), '');
  IF new_class IS NULL THEN
    RAISE EXCEPTION 'Confirm the vegan classification to reverify this place.';
  END IF;
  IF new_class NOT IN
     ('fully_vegan','fully_vegetarian','vegetarian_friendly','vegan_options','not_food') THEN
    RAISE EXCEPTION 'Unknown vegan classification.';
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  UPDATE public.community_places
     SET maintenance_status    = 'operational',
         status_note           = NULL,
         status_changed_at     = now(),
         status_changed_by     = me,
         last_reverified_at    = now(),
         verification_status   = 'verified',
         verified_at           = now(),
         verified_by           = me,
         veggie_classification = new_class,
         is_active             = true,
         updated_at            = now()
   WHERE id = _place_id;

  INSERT INTO public.community_place_status_history (
    community_place_id, old_status, new_status, old_is_active, new_is_active,
    action, note, changed_by
  ) VALUES (
    _place_id, p.maintenance_status, 'operational', p.is_active, true,
    'reverified', clean_note, me
  );

  RETURN jsonb_build_object('ok', true, 'place_id', _place_id, 'reverified_at', now(),
                            'veggie_classification', new_class);
END; $function$;

REVOKE ALL ON FUNCTION public.set_community_place_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverify_community_place(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._insert_notification(uuid, uuid, notification_type, text, uuid, text, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_community_place_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverify_community_place(uuid, text, text) TO authenticated;