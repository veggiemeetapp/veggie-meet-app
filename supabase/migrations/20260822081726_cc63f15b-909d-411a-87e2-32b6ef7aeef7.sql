DO $$
DECLARE m uuid := '4b2d4795-d38f-4f0d-919c-af630458d7a2';
BEGIN
  DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = m);
  DELETE FROM public.chats WHERE meetup_id = m;
  DELETE FROM public.attendance WHERE meetup_id = m;
  DELETE FROM public.notifications WHERE entity_type = 'meetup' AND entity_id = m;
  DELETE FROM public.notifications WHERE destination_type = 'meetup' AND destination_id = m;
  DELETE FROM public.meetups WHERE id = m AND title = 'WO-124G QA TEMP — delete me';
END $$;