-- WO-090 §5/§51 bounded, indexed follow-up lookup
CREATE INDEX IF NOT EXISTS attendance_profile_status_idx
  ON public.attendance (profile_id, status);
CREATE INDEX IF NOT EXISTS meetup_follow_up_state_profile_idx
  ON public.meetup_follow_up_state (profile_id);

-- WO-090 §3 server-authoritative, self-scoped, at-most-one pending follow-up.
CREATE OR REPLACE FUNCTION public.get_my_pending_follow_up()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; r RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RETURN NULL; END IF;

  SELECT m.id,
         m.title,
         m.cover_image_url,
         public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) AS ends_at
    INTO r
  FROM public.attendance a
  JOIN public.meetups m ON m.id = a.meetup_id
  WHERE a.profile_id = me
    -- §19 only genuine in-person attendance states qualify
    AND a.status IN ('checked_in','attended')
    -- §21 cancelled Meetups never prompt
    AND m.status <> 'cancelled'
    AND m.cancelled_at IS NULL
    -- §2 must have genuinely ended, server clock, Meetup timezone
    AND public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) <= now()
    -- §5 bounded window: no lifetime scan
    AND public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) > now() - INTERVAL '30 days'
    -- §2/§10/§12 already opened, dismissed
    AND NOT EXISTS (
      SELECT 1 FROM public.meetup_follow_up_state f
      WHERE f.profile_id = me AND f.meetup_id = m.id
        AND (f.viewed_at IS NOT NULL OR f.dismissed_at IS NOT NULL)
    )
    -- §15 already completed the follow-up (feedback given)
    AND NOT EXISTS (
      SELECT 1 FROM public.meetup_feedback fb
      WHERE fb.profile_id = me AND fb.meetup_id = m.id
    )
  -- §4 deterministic priority: most recently ended eligible Meetup first
  ORDER BY public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) DESC, m.id
  LIMIT 1;

  IF r.id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'meetup_id', r.id,
    'title', r.title,
    'cover_image_url', r.cover_image_url,
    'ended_at', r.ends_at,
    'server_time', now()
  );
END;
$$;

ALTER FUNCTION public.get_my_pending_follow_up() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_pending_follow_up() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_follow_up() TO authenticated, service_role;

-- WO-090 §14 idempotent dismissal: repeated dismissal keeps one canonical state.
CREATE OR REPLACE FUNCTION public.dismiss_meetup_follow_up(_meetup_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.meetup_follow_up_state (meetup_id, profile_id, prompted_at, dismissed_at)
  VALUES (_meetup_id, me, now(), now())
  ON CONFLICT (meetup_id, profile_id) DO UPDATE
    SET dismissed_at = COALESCE(public.meetup_follow_up_state.dismissed_at, now()),
        prompted_at = COALESCE(public.meetup_follow_up_state.prompted_at, now()),
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_meetup_follow_up(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_meetup_follow_up(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_meetup_follow_up_viewed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_meetup_follow_up_viewed(uuid) TO authenticated, service_role;

-- WO-090 §33 bounded follow-up analytics vocabulary
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
    -- WO-090 post-Meetup follow-up prompt (one event per logical action)
    'follow_up_prompt_shown','follow_up_opened','follow_up_dismissed'
  );
$function$;
