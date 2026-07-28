-- WO-041 Smoke Fixture Cleanup (public schema)
-- Requires: :run_id parameter. Dry-run by default.
--   psql -v run_id='WO041_SMOKE_20260801T090000Z' -f smoke_fixture_cleanup.sql
-- To actually delete, also pass:  -v mode=commit
--
-- Auth users and storage objects are NOT deleted here (privileged);
-- see smoke_fixture_admin_cleanup.md.

\set QUIET off
\if :{?mode}
\else
  \set mode dry
\endif
\echo run_id=:run_id  mode=:mode

BEGIN;

-- Identify smoke profiles from display_name marker
CREATE TEMP TABLE smoke_profiles AS
  SELECT id, auth_user_id, display_name
  FROM public.profiles
  WHERE display_name LIKE 'WO041 Smoke %' || :'run_id' || '%';

-- Identify smoke meetups from title marker (host may not still be a smoke profile)
CREATE TEMP TABLE smoke_meetups AS
  SELECT id
  FROM public.meetups
  WHERE title LIKE 'WO041 Smoke Meetup %' || :'run_id' || '%';

\echo '--- Counts BEFORE ---'
SELECT 'smoke_profiles' AS scope, count(*) FROM smoke_profiles
UNION ALL SELECT 'smoke_meetups', count(*) FROM smoke_meetups;

-- Dependency-aware deletion (children first). Guards: only touch rows
-- tied to the two temp tables above or bearing the RUN_ID marker.

-- Analytics
DELETE FROM public.analytics_events
  WHERE properties->>'wo041_run_id' = :'run_id'
     OR profile_id IN (SELECT id FROM smoke_profiles);

-- Messaging
DELETE FROM public.messages
  WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id IN (SELECT id FROM smoke_meetups))
     OR body LIKE '[WO041_SMOKE:' || :'run_id' || ']%';
DELETE FROM public.chat_participants
  WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id IN (SELECT id FROM smoke_meetups))
     OR profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.chats WHERE meetup_id IN (SELECT id FROM smoke_meetups);

DELETE FROM public.dm_messages
  WHERE body LIKE '[WO041_SMOKE:' || :'run_id' || ']%'
     OR sender_id IN (SELECT id FROM smoke_profiles)
     OR conversation_id IN (
       SELECT id FROM public.dm_conversations
       WHERE user_a_id IN (SELECT id FROM smoke_profiles)
          OR user_b_id IN (SELECT id FROM smoke_profiles));
DELETE FROM public.dm_conversations
  WHERE user_a_id IN (SELECT id FROM smoke_profiles)
     OR user_b_id IN (SELECT id FROM smoke_profiles);

-- Meetup-adjacent
DELETE FROM public.meetup_qr_tokens WHERE meetup_id IN (SELECT id FROM smoke_meetups);
DELETE FROM public.verified_meetup_connections WHERE meetup_id IN (SELECT id FROM smoke_meetups);
DELETE FROM public.check_in_requests
  WHERE meetup_id IN (SELECT id FROM smoke_meetups)
     OR requester_profile_id IN (SELECT id FROM smoke_profiles)
     OR target_profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetup_invitations
  WHERE meetup_id IN (SELECT id FROM smoke_meetups)
     OR sender_id IN (SELECT id FROM smoke_profiles)
     OR recipient_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetup_feedback
  WHERE meetup_id IN (SELECT id FROM smoke_meetups)
     OR profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetup_follow_up_state
  WHERE meetup_id IN (SELECT id FROM smoke_meetups)
     OR profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetup_update_seen
  WHERE meetup_id IN (SELECT id FROM smoke_meetups)
     OR profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetup_location_changes WHERE meetup_id IN (SELECT id FROM smoke_meetups);
DELETE FROM public.attendance
  WHERE meetup_id IN (SELECT id FROM smoke_meetups)
     OR profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetups WHERE id IN (SELECT id FROM smoke_meetups);

-- Relationship / safety
DELETE FROM public.friendships
  WHERE profile_a_id IN (SELECT id FROM smoke_profiles)
     OR profile_b_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.user_blocks
  WHERE blocker_profile_id IN (SELECT id FROM smoke_profiles)
     OR blocked_profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.meetup_reports
  WHERE reporter_profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.user_reports
  WHERE reporter_profile_id IN (SELECT id FROM smoke_profiles)
     OR reported_profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.safety_reports WHERE reporter_profile_id IN (SELECT id FROM smoke_profiles);

-- Place check-ins created by smoke profiles (real Community Places are protected)
DELETE FROM public.place_check_ins WHERE profile_id IN (SELECT id FROM smoke_profiles);

-- Recommendation feedback, notifications, deletion requests
DELETE FROM public.recommendation_feedback WHERE profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.notifications
  WHERE recipient_id IN (SELECT id FROM smoke_profiles)
     OR actor_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.account_deletion_requests WHERE profile_id IN (SELECT id FROM smoke_profiles);

-- Profile-owned state
DELETE FROM public.notification_preferences WHERE profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.profile_preferences WHERE profile_id IN (SELECT id FROM smoke_profiles);
DELETE FROM public.profile_onboarding_state WHERE profile_id IN (SELECT id FROM smoke_profiles);

-- Finally the profiles themselves (auth.users survive; owner deletes them)
DELETE FROM public.profiles WHERE id IN (SELECT id FROM smoke_profiles);

\echo '--- Counts AFTER (public schema) ---'
SELECT 'profiles remaining marker' AS scope, count(*) FROM public.profiles WHERE display_name LIKE '%'||:'run_id'||'%'
UNION ALL SELECT 'meetups remaining marker', count(*) FROM public.meetups WHERE title LIKE '%'||:'run_id'||'%'
UNION ALL SELECT 'messages marker', count(*) FROM public.messages WHERE body LIKE '%'||:'run_id'||'%'
UNION ALL SELECT 'dm_messages marker', count(*) FROM public.dm_messages WHERE body LIKE '%'||:'run_id'||'%'
UNION ALL SELECT 'analytics marker', count(*) FROM public.analytics_events WHERE properties->>'wo041_run_id' = :'run_id';

\echo '--- Auth users needing admin deletion (owner action) ---'
SELECT id, email FROM auth.users WHERE email LIKE 'wo041+%.' || :'run_id' || '@lovable-smoke.test';

\echo '--- Storage objects needing admin deletion (owner action) ---'
SELECT bucket_id, name FROM storage.objects WHERE name LIKE '%' || :'run_id' || '%';

\if :{?mode}
\endif
-- Safety: default to ROLLBACK; only COMMIT when mode=commit
\if :mode = 'commit'
COMMIT;
\echo 'COMMITTED cleanup for run_id=:run_id'
\else
ROLLBACK;
\echo 'DRY RUN — nothing committed. Re-run with -v mode=commit to apply.'
\endif
