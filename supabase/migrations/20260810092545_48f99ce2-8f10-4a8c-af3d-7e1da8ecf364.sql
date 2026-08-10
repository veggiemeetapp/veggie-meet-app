-- ============================================================
-- WO-089 — Private beta monitoring, feedback & incident response
-- ============================================================

CREATE TABLE public.beta_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  category text NOT NULL,
  surface text NOT NULL,
  message text NOT NULL,
  app_version text,
  route_template text,
  status text NOT NULL DEFAULT 'new',
  internal_note text,
  client_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beta_feedback_category_chk CHECK (category IN ('bug','confusing','suggestion','other')),
  CONSTRAINT beta_feedback_surface_chk CHECK (surface IN ('today','community','search','profile','meetup','chats','notifications','you','settings','community_place','other')),
  CONSTRAINT beta_feedback_status_chk CHECK (status IN ('new','reviewing','planned','resolved','wont_fix')),
  CONSTRAINT beta_feedback_message_chk CHECK (char_length(btrim(message)) BETWEEN 10 AND 2000),
  CONSTRAINT beta_feedback_version_chk CHECK (app_version IS NULL OR char_length(app_version) <= 64),
  CONSTRAINT beta_feedback_route_chk CHECK (route_template IS NULL OR char_length(route_template) <= 64),
  CONSTRAINT beta_feedback_note_chk CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000)
);

-- No anon/authenticated grants: every access path is a hardened SECDEF RPC.
GRANT ALL ON public.beta_feedback TO service_role;
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- Owner-only direct read (defence in depth; the UI uses the RPC).
CREATE POLICY "beta_feedback owner read" ON public.beta_feedback
  FOR SELECT TO authenticated USING (public.is_owner());

CREATE INDEX beta_feedback_status_created_idx ON public.beta_feedback (status, created_at DESC);
CREATE INDEX beta_feedback_profile_created_idx ON public.beta_feedback (profile_id, created_at DESC);
CREATE UNIQUE INDEX beta_feedback_idempotency_idx
  ON public.beta_feedback (profile_id, client_token)
  WHERE profile_id IS NOT NULL AND client_token IS NOT NULL;

CREATE TRIGGER beta_feedback_touch
  BEFORE UPDATE ON public.beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Member submission (server-authoritative actor) ----------
CREATE OR REPLACE FUNCTION public.submit_beta_feedback(
  _category text,
  _surface text,
  _message text,
  _app_version text DEFAULT NULL,
  _route_template text DEFAULT NULL,
  _client_token uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_msg text := btrim(coalesce(_message,''));
  v_recent_hour int;
  v_recent_day int;
  v_existing uuid;
  v_id uuid;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to send beta feedback.' USING ERRCODE = '42501';
  END IF;

  IF _category IS NULL OR _category NOT IN ('bug','confusing','suggestion','other') THEN
    RAISE EXCEPTION 'Choose a feedback category.';
  END IF;
  IF _surface IS NULL OR _surface NOT IN
     ('today','community','search','profile','meetup','chats','notifications','you','settings','community_place','other') THEN
    RAISE EXCEPTION 'Choose where this happened.';
  END IF;
  IF char_length(v_msg) < 10 THEN
    RAISE EXCEPTION 'Please add a little more detail (at least 10 characters).';
  END IF;
  IF char_length(v_msg) > 2000 THEN
    RAISE EXCEPTION 'Please keep feedback under 2000 characters.';
  END IF;

  -- Idempotency: a double tap with the same token returns the first row.
  IF _client_token IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.beta_feedback
     WHERE profile_id = v_pid AND client_token = _client_token;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT count(*) INTO v_recent_hour FROM public.beta_feedback
   WHERE profile_id = v_pid AND created_at > now() - interval '1 hour';
  IF v_recent_hour >= 5 THEN
    RAISE EXCEPTION 'You have sent a few notes already. Please try again later.';
  END IF;

  SELECT count(*) INTO v_recent_day FROM public.beta_feedback
   WHERE profile_id = v_pid AND created_at > now() - interval '24 hours';
  IF v_recent_day >= 20 THEN
    RAISE EXCEPTION 'You have sent a few notes already. Please try again later.';
  END IF;

  INSERT INTO public.beta_feedback
    (profile_id, category, surface, message, app_version, route_template, client_token)
  VALUES
    (v_pid, _category, _surface, v_msg,
     nullif(left(coalesce(_app_version,''), 64), ''),
     nullif(left(coalesce(_route_template,''), 64), ''),
     _client_token)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------- Owner queue ----------
CREATE OR REPLACE FUNCTION public.get_beta_feedback_queue(
  _status text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit int := least(greatest(coalesce(_limit,50),1),100);
  v_offset int := greatest(coalesce(_offset,0),0);
  v_items jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT f.id, f.category, f.surface, f.message, f.app_version, f.route_template,
           f.status, f.internal_note, f.created_at, f.updated_at,
           f.profile_id,
           coalesce(p.display_name, 'Former member') AS member_label,
           (f.profile_id IS NULL) AS member_removed
      FROM public.beta_feedback f
      LEFT JOIN public.profiles p ON p.id = f.profile_id
     WHERE (_status IS NULL OR f.status = _status)
     ORDER BY f.created_at DESC
     LIMIT v_limit OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'items', v_items,
    'counts', (
      SELECT coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
        FROM (SELECT status, count(*) c FROM public.beta_feedback GROUP BY status) s
    ),
    'total', (SELECT count(*) FROM public.beta_feedback)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_beta_feedback_status(
  _feedback_id uuid,
  _status text,
  _internal_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_row public.beta_feedback;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF _status IS NULL OR _status NOT IN ('new','reviewing','planned','resolved','wont_fix') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  UPDATE public.beta_feedback
     SET status = _status,
         internal_note = coalesce(nullif(btrim(coalesce(_internal_note,'')),''), internal_note)
   WHERE id = _feedback_id
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'This feedback is no longer available.';
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

-- ---------- Account deletion: retain anonymized feedback (WO-074 pattern) ----------
CREATE OR REPLACE FUNCTION public.anonymize_beta_feedback_on_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.beta_feedback
       SET profile_id = NULL, client_token = NULL
     WHERE profile_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_anonymize_beta_feedback
  AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.anonymize_beta_feedback_on_profile_delete();

-- ---------- Owner beta health summary ----------
CREATE OR REPLACE FUNCTION public.get_private_beta_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'feedback_new', (SELECT count(*) FROM public.beta_feedback WHERE status = 'new'),
    'feedback_unresolved', (SELECT count(*) FROM public.beta_feedback WHERE status IN ('new','reviewing','planned')),
    'feedback_total', (SELECT count(*) FROM public.beta_feedback),
    'error_events_24h', (
      SELECT count(*) FROM public.analytics_events
       WHERE created_at > now() - interval '24 hours'
         AND event_name IN ('error_boundary_activated','request_failed',
              'op_read_failed','op_mutation_failed','op_auth_failed',
              'op_realtime_failed','op_deeplink_failed','op_app_boot_failed')
    ),
    'error_surfaces_24h', (
      SELECT coalesce(jsonb_object_agg(surface, c), '{}'::jsonb) FROM (
        SELECT coalesce(properties->>'surface', properties->>'route', 'unknown') surface, count(*) c
          FROM public.analytics_events
         WHERE created_at > now() - interval '24 hours'
           AND event_name IN ('error_boundary_activated','request_failed',
                'op_read_failed','op_mutation_failed','op_auth_failed',
                'op_realtime_failed','op_deeplink_failed','op_app_boot_failed')
         GROUP BY 1 ORDER BY 2 DESC LIMIT 10
      ) s
    ),
    'latest_app_version', (
      SELECT properties->>'app_version' FROM public.analytics_events
       WHERE properties ? 'app_version' ORDER BY created_at DESC LIMIT 1
    ),
    'open_place_reports', (SELECT count(*) FROM public.community_place_reports WHERE status = 'open'),
    'pending_place_suggestions', (SELECT count(*) FROM public.community_place_suggestions WHERE moderation_status = 'pending'),
    'community_places_active', (SELECT count(*) FROM public.community_places WHERE is_active),
    'generated_at', now()
  );
END;
$$;

-- ---------- Owner aggregated operational failures ----------
CREATE OR REPLACE FUNCTION public.get_beta_operational_failures(
  _hours int DEFAULT 24,
  _limit int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hours int := least(greatest(coalesce(_hours,24),1),168);
  v_limit int := least(greatest(coalesce(_limit,50),1),100);
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(t) FROM (
      SELECT
        coalesce(properties->>'fingerprint','unknown') AS fingerprint,
        event_name,
        coalesce(properties->>'error_category', properties->>'category','unknown') AS error_category,
        coalesce(properties->>'surface', properties->>'route','unknown') AS surface,
        properties->>'app_version' AS app_version,
        count(*) AS count,
        min(created_at) AS first_seen,
        max(created_at) AS last_seen
        FROM public.analytics_events
       WHERE created_at > now() - make_interval(hours => v_hours)
         AND event_name IN ('error_boundary_activated','request_failed',
              'op_read_failed','op_mutation_failed','op_auth_failed',
              'op_realtime_failed','op_deeplink_failed','op_app_boot_failed')
       GROUP BY 1,2,3,4,5
       ORDER BY count(*) DESC, max(created_at) DESC
       LIMIT v_limit
    ) t
  ), '[]'::jsonb);
END;
$$;

-- ---------- Owner integrity invariants (read-only, aggregates only) ----------
CREATE OR REPLACE FUNCTION public.get_private_beta_integrity_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'friendship_integrity_issues', (
      SELECT count(*) FROM public.friendships f
       WHERE f.profile_a_id = f.profile_b_id
          OR f.profile_a_id > f.profile_b_id
          OR EXISTS (SELECT 1 FROM public.friendships g
                      WHERE g.id <> f.id
                        AND least(g.profile_a_id,g.profile_b_id) = least(f.profile_a_id,f.profile_b_id)
                        AND greatest(g.profile_a_id,g.profile_b_id) = greatest(f.profile_a_id,f.profile_b_id))
    ),
    'verified_connection_integrity_issues', (
      SELECT count(*) FROM public.verified_meetup_connections v
       WHERE v.profile_a_id = v.profile_b_id
          OR NOT EXISTS (SELECT 1 FROM public.attendance a
                          WHERE a.meetup_id = v.meetup_id AND a.profile_id = v.profile_a_id
                            AND a.status IN ('checked_in','attended'))
          OR NOT EXISTS (SELECT 1 FROM public.attendance a
                          WHERE a.meetup_id = v.meetup_id AND a.profile_id = v.profile_b_id
                            AND a.status IN ('checked_in','attended'))
    ),
    'attendance_integrity_issues', (
      SELECT coalesce(sum(c - 1),0) FROM (
        SELECT count(*) c FROM public.attendance GROUP BY meetup_id, profile_id HAVING count(*) > 1
      ) d
    ),
    'meetup_completion_integrity_issues', (
      SELECT count(*) FROM public.meetup_completions c
       WHERE NOT EXISTS (SELECT 1 FROM public.meetups m WHERE m.id = c.meetup_id AND m.host_id = c.host_id)
          OR EXISTS (SELECT 1 FROM public.meetup_completions d WHERE d.meetup_id = c.meetup_id AND d.id <> c.id)
    ),
    'orphan_message_issues', (
      (SELECT count(*) FROM public.messages m WHERE NOT EXISTS (SELECT 1 FROM public.chats c WHERE c.id = m.chat_id))
      + (SELECT count(*) FROM public.chats c WHERE NOT EXISTS (SELECT 1 FROM public.meetups m WHERE m.id = c.meetup_id))
      + (SELECT count(*) FROM public.dm_messages d WHERE NOT EXISTS (SELECT 1 FROM public.dm_conversations c WHERE c.id = d.conversation_id))
    ),
    'orphan_notification_issues', (
      SELECT count(*) FROM public.notifications n
       WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = n.recipient_id)
    ),
    'place_visit_integrity_issues', (
      SELECT count(*) FROM public.community_place_visits v
       WHERE NOT EXISTS (SELECT 1 FROM public.community_places p WHERE p.id = v.community_place_id)
          OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v.profile_id)
    ),
    'orphan_report_issues', (
      (SELECT count(*) FROM public.community_place_reports r
        WHERE NOT EXISTS (SELECT 1 FROM public.community_places p WHERE p.id = r.community_place_id))
      + (SELECT count(*) FROM public.meetup_reports r
        WHERE NOT EXISTS (SELECT 1 FROM public.meetups m WHERE m.id = r.meetup_id))
    ),
    'analytics_orphan_actor_issues', (
      SELECT count(*) FROM public.analytics_events e
       WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = e.profile_id)
    ),
    'qa_smoke_auth_users', (
      SELECT count(*) FROM auth.users u WHERE u.email ILIKE '%@lovable-smoke.test'
    ),
    'owner_allowlist_entries', (SELECT count(*) FROM public.owner_allowlist),
    'community_places_active', (SELECT count(*) FROM public.community_places WHERE is_active),
    'generated_at', now()
  ) INTO r;

  RETURN r;
END;
$$;

-- ---------- Lock down execution ----------
REVOKE ALL ON FUNCTION public.submit_beta_feedback(text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_beta_feedback_queue(text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_beta_feedback_status(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_private_beta_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_beta_operational_failures(int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_private_beta_integrity_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anonymize_beta_feedback_on_profile_delete() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_beta_feedback(text,text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_beta_feedback_queue(text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_beta_feedback_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_beta_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_beta_operational_failures(int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_beta_integrity_health() TO authenticated;

-- ---------- Operational event vocabulary (WO-084 sanitizer unchanged) ----------
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
    -- WO-089 operational failure vocabulary (observational only)
    'op_read_failed','op_mutation_failed','op_auth_failed','op_realtime_failed',
    'op_deeplink_failed','op_app_boot_failed',
    -- WO-089 beta feedback funnel
    'beta_feedback_opened','beta_feedback_submitted','beta_feedback_failed',
    'owner_beta_operations_opened','owner_beta_feedback_status_updated'
  );
$function$;