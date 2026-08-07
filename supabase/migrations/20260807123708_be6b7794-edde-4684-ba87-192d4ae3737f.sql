ALTER TABLE public.meetup_completions DISABLE TRIGGER USER;
ALTER TABLE public.meetups DISABLE TRIGGER USER;
ALTER TABLE public.attendance DISABLE TRIGGER USER;

CREATE TEMP TABLE _qa_meetups AS
SELECT id FROM public.meetups WHERE title LIKE 'WO063A QA%';

DELETE FROM public.meetup_completions WHERE meetup_id IN (SELECT id FROM _qa_meetups);
DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id IN (SELECT id FROM _qa_meetups));
DELETE FROM public.chat_participants WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id IN (SELECT id FROM _qa_meetups));
DELETE FROM public.chats WHERE meetup_id IN (SELECT id FROM _qa_meetups);
DELETE FROM public.attendance WHERE meetup_id IN (SELECT id FROM _qa_meetups);
DELETE FROM public.notifications
 WHERE entity_id IN (SELECT id FROM _qa_meetups)
    OR destination_id IN (SELECT id FROM _qa_meetups);
DELETE FROM public.meetup_update_seen WHERE meetup_id IN (SELECT id FROM _qa_meetups);
DELETE FROM public.meetups WHERE id IN (SELECT id FROM _qa_meetups);
DELETE FROM public.profiles WHERE display_name LIKE 'WO063A QA%' AND auth_user_id IS NULL;

ALTER TABLE public.attendance ENABLE TRIGGER USER;
ALTER TABLE public.meetups ENABLE TRIGGER USER;
ALTER TABLE public.meetup_completions ENABLE TRIGGER USER;