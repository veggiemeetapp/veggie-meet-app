ALTER TABLE public.community_place_identity_history DISABLE TRIGGER USER;
ALTER TABLE public.community_place_identity_reviews DISABLE TRIGGER USER;

DELETE FROM public.community_place_identity_history
 WHERE id IN ('10879126-5014-4dd3-99d7-bc603e78cc48','a3f2846d-0154-431a-809a-456a87b20ed8',
              '5fe5bdb7-9208-4321-8512-49130d1a6248','8924c48e-8d1a-4f42-bb32-231aec18e4b0');

DELETE FROM public.community_place_identity_reviews
 WHERE id IN ('3e2b532c-f35b-480d-82a4-829b015d746a','4afc171f-d469-4b8c-90c4-41549d75ff90',
              '6b7ffb24-3e48-4995-9fac-bf5445e6e16a','b6978647-61b6-4378-bdd2-646f62014728',
              '3a3a5829-a092-4851-8b9c-61b4749ba892','c3dbb596-af50-4a4b-8566-5e2e2415b009',
              '2f000a73-8a14-4687-aef7-69a6076cead4','2b672ca8-5476-4bd1-b3b8-1cc8f1e32c63');

ALTER TABLE public.community_place_identity_history ENABLE TRIGGER USER;
ALTER TABLE public.community_place_identity_reviews ENABLE TRIGGER USER;

DELETE FROM public.meetup_update_seen WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af';
DELETE FROM public.meetup_follow_up_state WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af';
DELETE FROM public.attendance WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af';
DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af');
DELETE FROM public.chat_participants WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af');
DELETE FROM public.chats WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af';
DELETE FROM public.meetup_location_changes WHERE meetup_id = '302cbf1a-41b6-4b2e-975e-c108510b09af';
DELETE FROM public.meetups WHERE id = '302cbf1a-41b6-4b2e-975e-c108510b09af';

DELETE FROM public.analytics_events
 WHERE event_name LIKE 'community_place_identity_review%'
   AND created_at::date = CURRENT_DATE;