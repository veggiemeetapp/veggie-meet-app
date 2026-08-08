SET session_replication_role = replica;

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.notifications WHERE recipient_id IN (SELECT id FROM qa) OR actor_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.analytics_events WHERE profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.dm_messages WHERE sender_id IN (SELECT id FROM qa)
   OR conversation_id IN (SELECT id FROM public.dm_conversations WHERE user_a_id IN (SELECT id FROM qa) OR user_b_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_invitations WHERE sender_id IN (SELECT id FROM qa) OR recipient_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.dm_conversations WHERE user_a_id IN (SELECT id FROM qa) OR user_b_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.messages WHERE sender_id IN (SELECT id FROM qa)
   OR chat_id IN (SELECT c.id FROM public.chats c JOIN public.meetups m ON m.id = c.meetup_id WHERE m.host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.chat_participants WHERE profile_id IN (SELECT id FROM qa)
   OR chat_id IN (SELECT c.id FROM public.chats c JOIN public.meetups m ON m.id = c.meetup_id WHERE m.host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.chats WHERE meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.attendance WHERE profile_id IN (SELECT id FROM qa)
   OR meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_update_seen WHERE profile_id IN (SELECT id FROM qa)
   OR meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_follow_up_state WHERE profile_id IN (SELECT id FROM qa)
   OR meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_feedback WHERE profile_id IN (SELECT id FROM qa)
   OR meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_qr_tokens WHERE issuer_profile_id IN (SELECT id FROM qa)
   OR meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.verified_meetup_connections WHERE profile_a_id IN (SELECT id FROM qa) OR profile_b_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_completions WHERE host_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_location_changes WHERE changed_by_profile_id IN (SELECT id FROM qa)
   OR meetup_id IN (SELECT id FROM public.meetups WHERE host_id IN (SELECT id FROM qa));

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetups WHERE host_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.friendships WHERE profile_a_id IN (SELECT id FROM qa) OR profile_b_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.user_blocks WHERE blocker_profile_id IN (SELECT id FROM qa) OR blocked_profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.community_place_suggestions WHERE submitted_by IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.community_place_reports WHERE reporter_profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.community_place_visits WHERE profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.recommendation_feedback WHERE profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.user_reports WHERE reporter_profile_id IN (SELECT id FROM qa) OR reported_profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.meetup_reports WHERE reporter_profile_id IN (SELECT id FROM qa) OR host_profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.safety_reports WHERE reporter_profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.profile_onboarding_state WHERE profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.profile_preferences WHERE profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.notification_preferences WHERE profile_id IN (SELECT id FROM qa);

WITH qa AS (SELECT id FROM public.profiles WHERE display_name LIKE 'wo071qa%')
DELETE FROM public.account_deletion_requests WHERE profile_id IN (SELECT id FROM qa);

DELETE FROM public.profiles WHERE display_name LIKE 'wo071qa%';

SET session_replication_role = DEFAULT;