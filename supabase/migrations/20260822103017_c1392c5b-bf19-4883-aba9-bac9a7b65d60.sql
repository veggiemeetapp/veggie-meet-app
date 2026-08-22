do $$
declare qa uuid := '59092068-dd94-41df-8c4d-443dac199017';
begin
  delete from public.notifications where meetup_id is not null and meetup_id = qa;
exception when undefined_column then
  null;
end $$;

delete from public.chat_participants where chat_id in (select id from public.chats where meetup_id = '59092068-dd94-41df-8c4d-443dac199017');
delete from public.chats where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.attendance where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_completions where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_feedback where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_follow_up_state where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_invitations where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_location_changes where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_qr_tokens where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_reports where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetup_update_seen where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.verified_meetup_connections where meetup_id = '59092068-dd94-41df-8c4d-443dac199017';
delete from public.meetups where id = '59092068-dd94-41df-8c4d-443dac199017';