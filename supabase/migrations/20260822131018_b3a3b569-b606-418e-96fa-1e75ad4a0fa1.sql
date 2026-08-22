DO $$
DECLARE mid uuid := '3acf5a4f-86c3-4128-a928-5fc0472fefb4';
BEGIN
  DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = mid);
  DELETE FROM public.chat_participants WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = mid);
  DELETE FROM public.chats WHERE meetup_id = mid;
  DELETE FROM public.verified_meetup_connections WHERE meetup_id = mid;
  DELETE FROM public.meetup_update_seen WHERE meetup_id = mid;
  DELETE FROM public.meetup_reports WHERE meetup_id = mid;
  DELETE FROM public.meetup_qr_tokens WHERE meetup_id = mid;
  DELETE FROM public.meetup_location_changes WHERE meetup_id = mid;
  DELETE FROM public.meetup_invitations WHERE meetup_id = mid;
  DELETE FROM public.meetup_follow_up_state WHERE meetup_id = mid;
  DELETE FROM public.meetup_feedback WHERE meetup_id = mid;
  DELETE FROM public.meetup_completions WHERE meetup_id = mid;
  DELETE FROM public.attendance WHERE meetup_id = mid;
  DELETE FROM public.meetups WHERE id = mid;
END $$;