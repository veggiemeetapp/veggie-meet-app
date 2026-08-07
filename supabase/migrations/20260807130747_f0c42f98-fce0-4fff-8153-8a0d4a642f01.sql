-- WO-064 QA cleanup (exact controlled records only).
DELETE FROM public.analytics_events WHERE event_name = 'WO064_QA_probe';

DELETE FROM public.messages WHERE chat_id IN (
  SELECT id FROM public.chats WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO064\_QA%')
);
DELETE FROM public.chat_participants WHERE chat_id IN (
  SELECT id FROM public.chats WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO064\_QA%')
);
DELETE FROM public.chats WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO064\_QA%');
DELETE FROM public.notifications
WHERE (metadata->>'meetupId')::text IN (SELECT id::text FROM public.meetups WHERE title LIKE 'WO064\_QA%')
   OR (metadata->>'meetup_id')::text IN (SELECT id::text FROM public.meetups WHERE title LIKE 'WO064\_QA%');
DELETE FROM public.meetup_location_changes WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO064\_QA%');
DELETE FROM public.meetup_update_seen WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO064\_QA%');
DELETE FROM public.attendance WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO064\_QA%');
DELETE FROM public.meetups WHERE title LIKE 'WO064\_QA%';
