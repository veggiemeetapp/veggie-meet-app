-- 1. Private member report table
CREATE TABLE public.community_place_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  reporter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  explanation text NOT NULL,
  official_source_url text,
  additional_details text,
  status text NOT NULL DEFAULT 'pending',
  owner_resolution text,
  owner_note text,
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Grants: no anon. Authenticated gets column-scoped SELECT only, so the
--    private owner_note / owner_resolution / resolved_by can never be read by
--    a member even with a direct Data API call. All writes go through RPCs.
GRANT SELECT (id, community_place_id, reporter_profile_id, reason_code,
              explanation, official_source_url, additional_details,
              status, created_at, updated_at)
  ON public.community_place_reports TO authenticated;
GRANT ALL ON public.community_place_reports TO service_role;

-- 3. RLS
ALTER TABLE public.community_place_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reporters read their own reports"
  ON public.community_place_reports FOR SELECT TO authenticated
  USING (reporter_profile_id = public.current_profile_id());

CREATE POLICY "Owners read the full report queue"
  ON public.community_place_reports FOR SELECT TO authenticated
  USING (public.is_owner());

-- No INSERT/UPDATE/DELETE policy: members cannot write directly, cannot set a
-- status, cannot spoof a reporter, and cannot delete a submitted report.

CREATE INDEX community_place_reports_place_idx
  ON public.community_place_reports (community_place_id, reason_code, status);
CREATE INDEX community_place_reports_reporter_idx
  ON public.community_place_reports (reporter_profile_id, created_at DESC);

CREATE TRIGGER set_community_place_reports_updated_at
  BEFORE UPDATE ON public.community_place_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Notification preference routing for the new types (community channel)
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
END;
$function$;

-- 5. Reporter notification helper. Never exposes owner identity, owner note,
--    maintenance reason, or other reporters. Dedup key is stable per status.
CREATE OR REPLACE FUNCTION public._notify_place_report(_report_id uuid, _recipient uuid, _place_name text, _status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text; v_type notification_type; v_title text; v_body text;
BEGIN
  IF _recipient IS NULL THEN RETURN; END IF;
  v_name := left(coalesce(nullif(btrim(_place_name), ''), 'this place'), 80);

  IF _status = 'under_review' THEN
    v_type := 'community_place_report_under_review';
    v_title := 'We''re reviewing your place report';
    v_body := 'Your report about ' || v_name || ' is now being reviewed.';
  ELSIF _status = 'resolved' THEN
    v_type := 'community_place_report_resolved';
    v_title := 'Your place report was reviewed';
    v_body := 'Thanks for helping us keep ' || v_name || ' accurate.';
  ELSIF _status = 'dismissed' THEN
    v_type := 'community_place_report_dismissed';
    v_title := 'Your place report was reviewed';
    v_body := 'We reviewed your report about ' || v_name || ', but no change was made.';
  ELSIF _status = 'duplicate' THEN
    v_type := 'community_place_report_duplicate';
    v_title := 'This issue was already reported';
    v_body := 'We already have a report about this issue at ' || v_name || '.';
  ELSE
    RETURN;
  END IF;

  PERFORM public._insert_notification(
    _recipient, NULL, v_type,
    'community_place_report', _report_id,
    'community_place_report', _report_id,
    v_title, v_body,
    jsonb_build_object('place_name', v_name),
    'community_place_report:' || _report_id::text || ':' || _status
  );
END;
$function$;

-- 6. Member submission RPC
CREATE OR REPLACE FUNCTION public.submit_community_place_report(_place_id uuid, _reason_code text, _explanation text, _official_source_url text DEFAULT NULL::text, _additional_details text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; expl text; url text; det text; nm text; recent int; new_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF _reason_code IS NULL OR _reason_code NOT IN (
    'permanently_closed','temporarily_closed','vegan_status_concern',
    'incorrect_name','incorrect_location','incorrect_source',
    'duplicate_place','other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reason');
  END IF;

  expl := btrim(regexp_replace(coalesce(_explanation,''), '\s+', ' ', 'g'));
  det  := nullif(btrim(coalesce(_additional_details,'')), '');
  url  := nullif(btrim(coalesce(_official_source_url,'')), '');

  IF expl = '' OR length(expl) < 20 OR length(expl) > 1000
     OR (det IS NOT NULL AND length(det) > 1500) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  IF url IS NOT NULL AND (length(url) > 500 OR url !~* '^https?://[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?\.[a-z]{2,}(:[0-9]+)?(/|\?|#|$)') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_url');
  END IF;

  -- Only published Community Places. Private candidates are never reportable.
  SELECT name INTO nm FROM public.community_places
   WHERE id = _place_id AND verification_status = 'verified';
  IF nm IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_not_found');
  END IF;

  -- Rate limit: 5 reports across all places per member per rolling 24 hours.
  SELECT count(*)::int INTO recent
    FROM public.community_place_reports
   WHERE reporter_profile_id = me AND created_at > now() - INTERVAL '24 hours';
  IF recent >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'report_limit_reached');
  END IF;

  -- One unresolved report per member + place + reason. Never reveals whether
  -- someone else reported the same place.
  IF EXISTS (
    SELECT 1 FROM public.community_place_reports
     WHERE reporter_profile_id = me
       AND community_place_id = _place_id
       AND reason_code = _reason_code
       AND status IN ('pending','under_review')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_report');
  END IF;

  INSERT INTO public.community_place_reports (
    community_place_id, reporter_profile_id, reason_code,
    explanation, official_source_url, additional_details, status
  ) VALUES (_place_id, me, _reason_code, expl, url, det, 'pending')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'report_submitted', 'report_id', new_id);
END;
$function$;

-- 7. Member history (safe fields only)
CREATE OR REPLACE FUNCTION public.get_my_place_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid; out jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'community_place_id', r.community_place_id,
    'place_name', p.name,
    'reason_code', r.reason_code,
    'status', r.status,
    'created_at', r.created_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO out
    FROM public.community_place_reports r
    JOIN public.community_places p ON p.id = r.community_place_id
   WHERE r.reporter_profile_id = me;
  RETURN out;
END;
$function$;

-- 8. Owner queue
CREATE OR REPLACE FUNCTION public.get_place_report_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE out jsonb;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'community_place_id', r.community_place_id,
    'place_name', p.name,
    'place_maintenance_status', coalesce(p.maintenance_status,'operational'),
    'reason_code', r.reason_code,
    'explanation', r.explanation,
    'official_source_url', r.official_source_url,
    'additional_details', r.additional_details,
    'status', r.status,
    'owner_resolution', r.owner_resolution,
    'reporter_profile_id', r.reporter_profile_id,
    'created_at', r.created_at,
    'resolved_at', r.resolved_at,
    'open_same_reason_count', (
      SELECT count(*)::int FROM public.community_place_reports r2
       WHERE r2.community_place_id = r.community_place_id
         AND r2.reason_code = r.reason_code
         AND r2.status IN ('pending','under_review'))
  ) ORDER BY
      CASE r.status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
      r.created_at ASC), '[]'::jsonb)
    INTO out
    FROM public.community_place_reports r
    JOIN public.community_places p ON p.id = r.community_place_id;
  RETURN out;
END;
$function$;

-- 9. Owner moderation. Place-status changes are delegated to the existing
--    WO-053 maintenance RPCs inside the same transaction; no status logic is
--    reimplemented here.
CREATE OR REPLACE FUNCTION public.moderate_community_place_report(_report_id uuid, _action text, _note text DEFAULT NULL::text, _place_action text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; r record; nm text; next_status text; clean_note text; maint jsonb := NULL;
BEGIN
  IF NOT public.is_owner() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'owner_only');
  END IF;
  me := public.current_profile_id();
  clean_note := nullif(btrim(coalesce(_note,'')), '');
  IF clean_note IS NOT NULL AND length(clean_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  SELECT * INTO r FROM public.community_place_reports
   WHERE id = _report_id FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'report_not_found');
  END IF;

  IF _action = 'start_review' THEN
    IF r.status <> 'pending' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    END IF;
    next_status := 'under_review';
  ELSIF _action = 'dismiss' THEN
    IF r.status NOT IN ('pending','under_review') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    END IF;
    IF clean_note IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
    END IF;
    next_status := 'dismissed';
  ELSIF _action = 'duplicate' THEN
    IF r.status NOT IN ('pending','under_review') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    END IF;
    next_status := 'duplicate';
  ELSIF _action = 'resolve' THEN
    IF r.status NOT IN ('pending','under_review') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    END IF;
    IF clean_note IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
    END IF;
    next_status := 'resolved';
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  END IF;

  -- Optional place maintenance action, delegated to WO-053.
  IF _place_action IS NOT NULL AND _action = 'resolve' THEN
    IF _place_action NOT IN ('needs_reverification','temporarily_closed','permanently_closed') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.community_places WHERE id = r.community_place_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'place_not_found');
    END IF;
    maint := public.set_community_place_status(r.community_place_id, _place_action, clean_note);
  END IF;

  UPDATE public.community_place_reports
     SET status = next_status,
         owner_resolution = CASE WHEN next_status = 'under_review'
                                 THEN owner_resolution
                                 ELSE coalesce(_place_action, _action) END,
         owner_note = coalesce(clean_note, owner_note),
         resolved_by = CASE WHEN next_status = 'under_review' THEN resolved_by ELSE me END,
         resolved_at = CASE WHEN next_status = 'under_review' THEN resolved_at ELSE now() END
   WHERE id = _report_id;

  SELECT name INTO nm FROM public.community_places WHERE id = r.community_place_id;
  PERFORM public._notify_place_report(r.id, r.reporter_profile_id, nm, next_status);

  RETURN jsonb_build_object(
    'ok', true, 'reason', 'success', 'status', next_status,
    'maintenance', maint
  );
END;
$function$;

-- 10. Execution grants: authenticated only for member paths, owner-gated
--     internally for the queue/moderation. No PUBLIC, no anon anywhere.
REVOKE ALL ON FUNCTION public._notify_place_report(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_community_place_report(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_place_reports() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_place_report_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_community_place_report(uuid, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_community_place_report(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_place_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_place_report_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_community_place_report(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._notify_place_report(uuid, uuid, text, text) TO service_role;