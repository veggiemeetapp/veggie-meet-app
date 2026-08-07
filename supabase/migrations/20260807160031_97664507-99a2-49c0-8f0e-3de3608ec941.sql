DO $$
DECLARE ids uuid[] := ARRAY['3ae74b1f-fbed-48b4-b3c7-d6210658fc7a','ee7f3ab9-9016-4f6b-affb-ecba142a17cc','61bb1668-3ec0-43a8-9d5d-e636bd7087fb']::uuid[];
  mid uuid := 'a5b3e1f9-4a37-4622-a3d2-ed361099325c';
BEGIN
  SET session_replication_role = replica;

  DELETE FROM public.verified_meetup_connections WHERE profile_a_id = ANY(ids) OR profile_b_id = ANY(ids);
  DELETE FROM public.friendships WHERE profile_a_id = ANY(ids) OR profile_b_id = ANY(ids);
  DELETE FROM public.user_blocks WHERE blocker_profile_id = ANY(ids) OR blocked_profile_id = ANY(ids);
  DELETE FROM public.meetup_qr_tokens WHERE meetup_id = mid OR issuer_profile_id = ANY(ids);
  DELETE FROM public.attendance WHERE meetup_id = mid OR profile_id = ANY(ids);
  DELETE FROM public.meetup_completions WHERE meetup_id = mid OR host_id = ANY(ids);
  DELETE FROM public.meetup_feedback WHERE meetup_id = mid OR profile_id = ANY(ids);
  DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = mid);
  DELETE FROM public.chat_participants WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = mid) OR profile_id = ANY(ids);
  DELETE FROM public.chats WHERE meetup_id = mid;
  DELETE FROM public.meetup_update_seen WHERE meetup_id = mid OR profile_id = ANY(ids);
  DELETE FROM public.meetup_follow_up_state WHERE meetup_id = mid OR profile_id = ANY(ids);
  DELETE FROM public.meetup_location_changes WHERE meetup_id = mid;
  DELETE FROM public.dm_messages WHERE sender_id = ANY(ids);
  DELETE FROM public.meetup_invitations WHERE sender_id = ANY(ids) OR recipient_id = ANY(ids) OR meetup_id = mid;
  DELETE FROM public.dm_conversations WHERE user_a_id = ANY(ids) OR user_b_id = ANY(ids);
  DELETE FROM public.meetups WHERE id = mid OR host_id = ANY(ids);
  DELETE FROM public.notifications WHERE recipient_id = ANY(ids) OR actor_id = ANY(ids);
  DELETE FROM public.analytics_events WHERE profile_id = ANY(ids);
  DELETE FROM public.recommendation_feedback WHERE profile_id = ANY(ids);
  DELETE FROM public.community_place_visits WHERE profile_id = ANY(ids);
  DELETE FROM public.profile_onboarding_state WHERE profile_id = ANY(ids);
  DELETE FROM public.profile_preferences WHERE profile_id = ANY(ids);
  DELETE FROM public.notification_preferences WHERE profile_id = ANY(ids);
  DELETE FROM public.profiles WHERE id = ANY(ids);

  SET session_replication_role = origin;
END $$;