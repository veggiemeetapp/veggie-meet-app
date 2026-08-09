-- WO-084: controlled event vocabulary, payload bounds, rate bound.
CREATE OR REPLACE FUNCTION public.analytics_event_allowed(_event_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT _event_name = ANY (ARRAY[
    'account_deletion_blocked',
    'account_deletion_completed',
    'account_deletion_started',
    'auth_signin_success',
    'auth_signup_started',
    'auth_signup_success',
    'check_in_started_from_plans',
    'community_impact_place_count_updated',
    'community_place_card_opened',
    'community_place_check_in_failed',
    'community_place_check_in_started',
    'community_place_check_in_succeeded',
    'community_place_detail_opened',
    'community_place_directions_opened',
    'community_place_edit_blocked',
    'community_place_edit_completed',
    'community_place_edit_google_checked',
    'community_place_edit_opened',
    'community_place_edit_previewed',
    'community_place_host_started',
    'community_place_identity_review_blocked',
    'community_place_identity_review_cancelled',
    'community_place_identity_review_completed',
    'community_place_identity_review_opened',
    'community_place_identity_review_started',
    'community_place_meetup_opened',
    'community_place_operations_activity_loaded_more',
    'community_place_operations_attention_opened',
    'community_place_operations_filter_changed',
    'community_place_operations_place_opened',
    'community_place_report_blocked',
    'community_place_report_history_opened',
    'community_place_report_moderated',
    'community_place_report_notification_opened',
    'community_place_report_owner_opened',
    'community_place_report_started',
    'community_place_report_submitted',
    'community_place_reverification_cancelled',
    'community_place_reverification_completed',
    'community_place_reverification_queue_opened',
    'community_place_reverification_started',
    'community_place_shared',
    'community_place_suggestion_failed',
    'community_place_suggestion_owner_opened',
    'community_place_suggestion_promoted',
    'community_place_suggestion_started',
    'community_place_suggestion_submitted',
    'community_place_vegan_review_blocked',
    'community_place_vegan_review_cancelled',
    'community_place_vegan_review_completed',
    'community_place_vegan_review_opened',
    'community_place_vegan_review_started',
    'community_places_filter_changed',
    'community_places_opened',
    'discovery_settings_saved',
    'error_boundary_activated',
    'location_permission_result',
    'meetup_check_in_blocked',
    'meetup_check_in_completed',
    'meetup_check_in_started',
    'meetup_community_place_opened',
    'meetup_community_place_selected',
    'meetup_community_place_viewed',
    'meetup_completion_blocked',
    'meetup_completion_completed',
    'meetup_completion_started',
    'meetup_created',
    'meetup_created_at_community_place',
    'meetup_left_from_plans',
    'meetup_location_change_notification_opened',
    'meetup_location_mode_selected',
    'meetup_location_review_opened',
    'meetup_location_update_blocked',
    'meetup_location_update_completed',
    'meetup_location_update_started',
    'member_blocked',
    'member_reported',
    'my_plans_opened',
    'notification_permission_result',
    'notification_preference_changed',
    'offline_detected',
    'onboarding_completed',
    'onboarding_starting_action_chosen',
    'onboarding_step_completed',
    'onboarding_step_viewed',
    'place_suggestion_history_opened',
    'place_suggestion_notification_created',
    'place_suggestion_notification_opened',
    'plan_opened',
    'profile_visibility_changed',
    'reconnect_completed',
    'request_failed',
    'settings_opened',
    'settings_profile_updated',
    'sign_out_completed',
    'supported_place_card_opened',
    'supported_places_explore_clicked',
    'supported_places_opened'
  ]::text[]);
$$;

REVOKE ALL ON FUNCTION public.analytics_event_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_event_allowed(text) TO authenticated;

-- Strip/bound analytics properties. Depth 1 only, controlled key denylist,
-- bounded key count, bounded string length, bounded total bytes.
CREATE OR REPLACE FUNCTION public.analytics_sanitize_properties(_properties jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  src jsonb := COALESCE(_properties, '{}'::jsonb);
  out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  n int := 0;
BEGIN
  IF jsonb_typeof(src) <> 'object' THEN RETURN '{}'::jsonb; END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(src) LOOP
    EXIT WHEN n >= 12;                       -- max 12 keys
    CONTINUE WHEN length(k) > 40;            -- absurd key names dropped
    -- Sensitive key denylist (email, auth ids, tokens, coordinates,
    -- message/report/profile free text, raw queries and raw errors).
    CONTINUE WHEN k ~* '(^|_)(e?mail|token|jwt|password|secret|auth_user_id|user_id|uid|lat|latitude|lng|lon|longitude|coord|coords|accuracy|position|body|content|bio|display_name|query|search_term|q|details_text|explanation|reason_text|note|stack|sql|raw_error)($|_)';
    IF jsonb_typeof(v) IN ('object', 'array') THEN
      CONTINUE;                              -- depth 1 only: nested payloads dropped
    END IF;
    IF jsonb_typeof(v) = 'string' THEN
      v := to_jsonb(left(v #>> '{}', 64));   -- bounded string values
    END IF;
    out := out || jsonb_build_object(k, v);
    n := n + 1;
  END LOOP;

  IF octet_length(out::text) > 2048 THEN
    RETURN '{"truncated": true}'::jsonb;     -- hard byte bound
  END IF;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_sanitize_properties(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_sanitize_properties(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_analytics_event(_event_name text, _properties jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pid uuid;
  recent int;
BEGIN
  -- Actor is always derived from auth; a client-supplied actor is impossible.
  pid := public.current_profile_id();
  IF pid IS NULL THEN RETURN; END IF;

  -- Unknown event names are safely ignored (analytics is best-effort and must
  -- never surface an error into a product flow).
  IF _event_name IS NULL OR NOT public.analytics_event_allowed(_event_name) THEN
    RETURN;
  END IF;

  -- Bounded volume: at most 400 events per actor per rolling hour.
  SELECT count(*) INTO recent
  FROM public.analytics_events
  WHERE profile_id = pid AND created_at > now() - interval '1 hour';
  IF recent >= 400 THEN RETURN; END IF;

  INSERT INTO public.analytics_events (profile_id, event_name, properties)
  VALUES (pid, _event_name, public.analytics_sanitize_properties(_properties));
END;
$$;

REVOKE ALL ON FUNCTION public.log_analytics_event(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_analytics_event(text, jsonb) TO authenticated;

-- Direct member writes stay denied at the privilege level; drop the vestigial
-- INSERT policy so the table has no member-facing write path at all.
DROP POLICY IF EXISTS "own analytics insert" ON public.analytics_events;