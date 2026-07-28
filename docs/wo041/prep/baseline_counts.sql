-- WO-041 Baseline Counts — run inside the FRESH production project
-- before any smoke traffic. Compare against expected values below.
-- Read-only.

\echo '=== User-generated tables (expected 0 pre-smoke) ==='
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

\echo '=== Reference tables (expected nonzero after seed) ==='
SELECT 'cities' AS t, count(*) AS n, 5 AS expected FROM public.cities
UNION ALL SELECT 'interest_catalogue', count(*), 12 FROM public.interest_catalogue
UNION ALL SELECT 'community_places', count(*), 0 FROM public.community_places;

\echo '=== Auth users (expected 0) ==='
SELECT count(*) AS auth_users FROM auth.users;

\echo '=== Storage objects by bucket (expected 0) ==='
SELECT bucket_id, count(*) FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;

\echo '=== QA/fixture pattern detection (expected empty everywhere) ==='
SELECT 'profiles' AS scope, id::text, display_name AS marker FROM public.profiles
  WHERE display_name ~* '(QA|WO-|WO0|Batch|Fixture|Race Test|Retest|probe_|__)'
UNION ALL
SELECT 'meetups', id::text, title FROM public.meetups
  WHERE title ~* '(QA|WO-|WO0|Batch|Fixture|Race Test|Retest|probe_|__)'
UNION ALL
SELECT 'community_places', id::text, name FROM public.community_places
  WHERE name ~* '(QA|WO-|WO0|Batch|Fixture|probe_|__)'
UNION ALL
SELECT 'auth.users', id::text, email FROM auth.users
  WHERE email ~* '(qa|wo-?041|smoke|fixture|probe_|\+test|@example\.)'
ORDER BY 1, 3;
