
-- Wire up missing triggers so check-in confirmation creates the friendship.
DROP TRIGGER IF EXISTS trg_check_in_confirmed ON public.check_in_requests;
CREATE TRIGGER trg_check_in_confirmed
AFTER UPDATE ON public.check_in_requests
FOR EACH ROW EXECUTE FUNCTION public.handle_check_in_confirmed();

DROP TRIGGER IF EXISTS trg_canonicalize_friendship ON public.friendships;
CREATE TRIGGER trg_canonicalize_friendship
BEFORE INSERT ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_friendship();

-- Restore other expected triggers if missing (idempotent).
DROP TRIGGER IF EXISTS trg_handle_new_user ON auth.users;
CREATE TRIGGER trg_handle_new_user
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS trg_handle_new_meetup ON public.meetups;
CREATE TRIGGER trg_handle_new_meetup
AFTER INSERT ON public.meetups
FOR EACH ROW EXECUTE FUNCTION public.handle_new_meetup();

DROP TRIGGER IF EXISTS trg_handle_new_attendance ON public.attendance;
CREATE TRIGGER trg_handle_new_attendance
AFTER INSERT ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.handle_new_attendance();
