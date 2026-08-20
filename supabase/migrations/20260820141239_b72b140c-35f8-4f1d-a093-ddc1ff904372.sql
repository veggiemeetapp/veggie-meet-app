DO $$
DECLARE qa uuid := '55ba801e-60f4-4497-a149-b8e282c3a7cb';
BEGIN
  DELETE FROM public.meetup_update_seen WHERE meetup_id = qa;
  DELETE FROM public.meetup_location_changes WHERE meetup_id = qa;
  DELETE FROM public.meetup_qr_tokens WHERE meetup_id = qa;
  DELETE FROM public.meetup_invitations WHERE meetup_id = qa;
  DELETE FROM public.meetup_completions WHERE meetup_id = qa;
  DELETE FROM public.meetup_follow_up_state WHERE meetup_id = qa;
  DELETE FROM public.meetup_feedback WHERE meetup_id = qa;
  DELETE FROM public.meetup_reports WHERE meetup_id = qa;
  DELETE FROM public.verified_meetup_connections WHERE meetup_id = qa;
  DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = qa);
  DELETE FROM public.chats WHERE meetup_id = qa;
  DELETE FROM public.attendance WHERE meetup_id = qa;
  DELETE FROM public.meetups WHERE id = qa;
END $$;