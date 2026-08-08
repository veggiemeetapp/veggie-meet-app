REVOKE EXECUTE ON FUNCTION public.create_hosted_meetup(text, text, text, date, time, time, integer, uuid, uuid, text, text, text, double precision, double precision, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.meetup_start_at(date, time, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.meetup_end_at(date, time, time, text) FROM anon, PUBLIC;