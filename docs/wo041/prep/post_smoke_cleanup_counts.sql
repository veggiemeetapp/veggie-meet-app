-- WO-041 Post-Smoke Cleanup Counts
-- Run AFTER smoke_fixture_cleanup.sql (public-schema) and owner-executed
-- auth/storage cleanup. Every user-generated table MUST be 0.
-- Reference tables MUST match baseline (cities=5, interests=12, places=0).

\echo '=== Public-schema user-generated tables (all MUST be 0) ==='
SELECT 'profiles' AS t, count(*) FROM public.profiles
UNION ALL SELECT 'profile_preferences', count(*) FROM public.profile_preferences
UNION ALL SELECT 'profile_onboarding_state', count(*) FROM public.profile_onboarding_state
UNION ALL SELECT 'meetups', count(*) FROM public.meetups
UNION ALL SELECT 'attendance', count(*) FROM public.attendance
UNION ALL SELECT 'meetup_invitations', count(*) FROM public.meetup_invitations
UNION ALL SELECT 'friendships', count(*) FROM public.friendships
UNION ALL SELECT 'user_blocks', count(*) FROM public.user_blocks
UNION ALL SELECT 'dm_conversations', count(*) FROM public.dm_conversations
UNION ALL SELECT 'dm_messages', count(*) FROM public.dm_messages
UNION ALL SELECT 'chats', count(*) FROM public.chats
UNION ALL SELECT 'chat_participants', count(*) FROM public.chat_participants
UNION ALL SELECT 'messages', count(*) FROM public.messages
UNION ALL SELECT 'notifications', count(*) FROM public.notifications
UNION ALL SELECT 'notification_preferences', count(*) FROM public.notification_preferences
UNION ALL SELECT 'analytics_events', count(*) FROM public.analytics_events
UNION ALL SELECT 'verified_meetup_connections', count(*) FROM public.verified_meetup_connections
UNION ALL SELECT 'place_check_ins', count(*) FROM public.place_check_ins
UNION ALL SELECT 'safety_reports', count(*) FROM public.safety_reports
UNION ALL SELECT 'meetup_reports', count(*) FROM public.meetup_reports
UNION ALL SELECT 'user_reports', count(*) FROM public.user_reports
UNION ALL SELECT 'meetup_qr_tokens', count(*) FROM public.meetup_qr_tokens
UNION ALL SELECT 'check_in_requests', count(*) FROM public.check_in_requests
UNION ALL SELECT 'meetup_follow_up_state', count(*) FROM public.meetup_follow_up_state
UNION ALL SELECT 'meetup_update_seen', count(*) FROM public.meetup_update_seen
UNION ALL SELECT 'meetup_feedback', count(*) FROM public.meetup_feedback
UNION ALL SELECT 'meetup_location_changes', count(*) FROM public.meetup_location_changes
UNION ALL SELECT 'recommendation_feedback', count(*) FROM public.recommendation_feedback
UNION ALL SELECT 'account_deletion_requests', count(*) FROM public.account_deletion_requests
ORDER BY 1;

\echo '=== Reference (MUST equal baseline) ==='
SELECT 'cities' AS t, count(*) AS n, 5 AS expected FROM public.cities
UNION ALL SELECT 'interest_catalogue', count(*), 12 FROM public.interest_catalogue
UNION ALL SELECT 'community_places', count(*), 0 FROM public.community_places;

\echo '=== Auth users (MUST be 0 after owner cleanup) ==='
SELECT count(*) AS auth_users FROM auth.users;
SELECT id, email FROM auth.users WHERE email ILIKE '%wo041%smoke%' OR email ILIKE '%smoke%wo041%';

\echo '=== Storage objects (MUST be 0) ==='
SELECT bucket_id, count(*) FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;

\echo '=== Discovery-visible smoke profiles / public smoke Meetups / test Community Places (MUST all be empty) ==='
SELECT id, display_name FROM public.profiles WHERE discovery_visible = true;  -- expect none
SELECT id, title, status FROM public.meetups
  WHERE title ILIKE '%WO041%SMOKE%' OR title ILIKE '%smoke%';
SELECT id, name FROM public.community_places
  WHERE name ~* '(smoke|wo041|qa|wo-|wo0|fixture|probe_|__)';

\echo '=== Cleanup PASS criterion: every count above is 0 except cities=5, interests=12. ==='
