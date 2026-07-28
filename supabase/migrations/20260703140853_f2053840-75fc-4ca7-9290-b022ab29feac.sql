
-- Trigger: create profile on new auth user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: on new meetup, create chat + host participant + system message + host attendance
DROP TRIGGER IF EXISTS on_meetup_created ON public.meetups;
CREATE TRIGGER on_meetup_created
  AFTER INSERT ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_meetup();

-- Trigger: on new attendance, add chat participant + joined system message
DROP TRIGGER IF EXISTS on_attendance_created ON public.attendance;
CREATE TRIGGER on_attendance_created
  AFTER INSERT ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_attendance();

-- updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_profiles ON public.profiles;
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_meetups ON public.meetups;
CREATE TRIGGER set_updated_at_meetups BEFORE UPDATE ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_attendance ON public.attendance;
CREATE TRIGGER set_updated_at_attendance BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_chats ON public.chats;
CREATE TRIGGER set_updated_at_chats BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_community_places ON public.community_places;
CREATE TRIGGER set_updated_at_community_places BEFORE UPDATE ON public.community_places
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The trigger handle_new_meetup inserts into public.chats as SECURITY DEFINER
-- so no user-level INSERT policy on chats is required. All good.

-- Ensure realtime works for messages (nice-to-have for live chat updates)
ALTER TABLE public.messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
END $$;
