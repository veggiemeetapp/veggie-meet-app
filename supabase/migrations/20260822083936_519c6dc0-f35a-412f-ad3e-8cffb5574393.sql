do $$
declare m uuid := 'b6f72258-ce3c-400e-a8d9-38949fe0739c';
begin
  delete from public.notifications where entity_type = 'meetup' and entity_id = m;
  delete from public.chat_participants where chat_id in (select id from public.chats where meetup_id = m);
  delete from public.chats where meetup_id = m;
  delete from public.attendance where meetup_id = m;
  delete from public.meetups where id = m;
end $$;