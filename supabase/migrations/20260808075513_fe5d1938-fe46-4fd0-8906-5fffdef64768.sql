DO $$
DECLARE qa uuid[] := ARRAY[
  '79d58fa9-c9d4-4c6d-80e3-7a8c6d07fd2c',
  '00f465b3-430f-4d63-9ff7-10fa32695bf9',
  '33d4714a-bf7b-4847-8c28-b4596bed40b0']::uuid[];
  qm uuid[];
BEGIN
  SET session_replication_role = replica;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO qm
    FROM public.meetups WHERE host_id = ANY(qa);

  DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = ANY(qm));
  DELETE FROM public.chat_participants WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = ANY(qm)) OR profile_id = ANY(qa);
  DELETE FROM public.chats WHERE meetup_id = ANY(qm);
  DELETE FROM public.dm_messages WHERE sender_id = ANY(qa)
     OR conversation_id IN (SELECT id FROM public.dm_conversations WHERE user_a_id = ANY(qa) OR user_b_id = ANY(qa));
  DELETE FROM public.meetup_invitations WHERE sender_id = ANY(qa) OR recipient_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.dm_conversations WHERE user_a_id = ANY(qa) OR user_b_id = ANY(qa);
  DELETE FROM public.verified_meetup_connections WHERE profile_a_id = ANY(qa) OR profile_b_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.meetup_qr_tokens WHERE issuer_profile_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.meetup_completions WHERE host_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.meetup_feedback WHERE profile_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.meetup_follow_up_state WHERE profile_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.meetup_update_seen WHERE profile_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.meetup_location_changes WHERE changed_by_profile_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.attendance WHERE profile_id = ANY(qa) OR meetup_id = ANY(qm) OR removed_by = ANY(qa);
  DELETE FROM public.meetup_reports WHERE reporter_profile_id = ANY(qa) OR host_profile_id = ANY(qa) OR meetup_id = ANY(qm);
  DELETE FROM public.safety_reports WHERE reporter_profile_id = ANY(qa) OR context_meetup_id = ANY(qm);
  DELETE FROM public.user_reports WHERE reporter_profile_id = ANY(qa) OR reported_profile_id = ANY(qa) OR reported_sender_profile_id = ANY(qa);
  DELETE FROM public.user_blocks WHERE blocker_profile_id = ANY(qa) OR blocked_profile_id = ANY(qa);
  DELETE FROM public.friendships WHERE profile_a_id = ANY(qa) OR profile_b_id = ANY(qa) OR requester_id = ANY(qa) OR first_meetup_id = ANY(qm);
  DELETE FROM public.recommendation_feedback WHERE profile_id = ANY(qa);
  DELETE FROM public.community_place_visits WHERE profile_id = ANY(qa);
  DELETE FROM public.notifications WHERE recipient_id = ANY(qa) OR actor_id = ANY(qa);
  DELETE FROM public.meetups WHERE id = ANY(qm);
  DELETE FROM public.analytics_events WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_onboarding_state WHERE profile_id = ANY(qa);
  DELETE FROM public.profile_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.notification_preferences WHERE profile_id = ANY(qa);
  DELETE FROM public.account_deletion_requests WHERE profile_id = ANY(qa);
  DELETE FROM public.profiles WHERE id = ANY(qa);

  SET session_replication_role = DEFAULT;
END $$;