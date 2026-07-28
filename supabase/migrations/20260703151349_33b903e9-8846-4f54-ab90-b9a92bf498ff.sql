
-- Install triggers to keep meetup/attendance/chat lifecycle synchronized.

DROP TRIGGER IF EXISTS on_meetup_created ON public.meetups;
CREATE TRIGGER on_meetup_created
  AFTER INSERT ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_meetup();

DROP TRIGGER IF EXISTS on_attendance_created ON public.attendance;
CREATE TRIGGER on_attendance_created
  AFTER INSERT ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_attendance();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: make sure every meetup has a chat, host attendance, and host participant.
INSERT INTO public.chats (meetup_id)
SELECT m.id FROM public.meetups m
LEFT JOIN public.chats c ON c.meetup_id = m.id
WHERE c.id IS NULL;

INSERT INTO public.attendance (profile_id, meetup_id, status)
SELECT m.host_id, m.id, 'joined'
FROM public.meetups m
LEFT JOIN public.attendance a
  ON a.meetup_id = m.id AND a.profile_id = m.host_id
WHERE a.id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.chat_participants (chat_id, profile_id)
SELECT c.id, a.profile_id
FROM public.chats c
JOIN public.attendance a ON a.meetup_id = c.meetup_id
LEFT JOIN public.chat_participants cp
  ON cp.chat_id = c.id AND cp.profile_id = a.profile_id
WHERE cp.id IS NULL
ON CONFLICT DO NOTHING;
