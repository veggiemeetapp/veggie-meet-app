DO $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM public.meetups WHERE title LIKE 'WO051%';
  IF ids IS NULL THEN RETURN; END IF;

  DELETE FROM public.notifications WHERE entity_id = ANY(ids) OR destination_id = ANY(ids);
  DELETE FROM public.meetup_location_changes WHERE meetup_id = ANY(ids);
  DELETE FROM public.meetup_update_seen WHERE meetup_id = ANY(ids);
  DELETE FROM public.meetup_follow_up_state WHERE meetup_id = ANY(ids);
  DELETE FROM public.meetup_feedback WHERE meetup_id = ANY(ids);
  DELETE FROM public.meetup_qr_tokens WHERE meetup_id = ANY(ids);
  DELETE FROM public.verified_meetup_connections WHERE meetup_id = ANY(ids);
  DELETE FROM public.check_in_requests WHERE meetup_id = ANY(ids);
  DELETE FROM public.meetup_reports WHERE meetup_id = ANY(ids);
  DELETE FROM public.meetup_invitations WHERE meetup_id = ANY(ids);
  DELETE FROM public.attendance WHERE meetup_id = ANY(ids);
  DELETE FROM public.messages WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = ANY(ids));
  DELETE FROM public.chat_participants WHERE chat_id IN (SELECT id FROM public.chats WHERE meetup_id = ANY(ids));
  DELETE FROM public.chats WHERE meetup_id = ANY(ids);
  UPDATE public.friendships SET first_meetup_id = NULL WHERE first_meetup_id = ANY(ids);
  UPDATE public.safety_reports SET context_meetup_id = NULL WHERE context_meetup_id = ANY(ids);
  DELETE FROM public.meetups WHERE id = ANY(ids);
END $$;

UPDATE public.profiles
   SET meetups_hosted_count = 0,
       meetups_attended_count = 0,
       veggies_met_count = 0,
       is_active_host = false
 WHERE NOT EXISTS (SELECT 1 FROM public.meetups);

DELETE FROM public.analytics_events WHERE created_at > now() - interval '2 hours';