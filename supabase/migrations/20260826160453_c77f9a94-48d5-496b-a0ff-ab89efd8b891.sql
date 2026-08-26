-- WO-133: the cover-editing entry point must never be reachable by an
-- unauthenticated caller. The routine already rejects non-hosts, but the
-- signed-out role should not be able to invoke it at all (WO-126 posture).
REVOKE ALL ON FUNCTION public.update_hosted_meetup(uuid, text, text, date, time without time zone, time without time zone, integer, uuid, text, text, text, text, text[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_hosted_meetup(uuid, text, text, date, time without time zone, time without time zone, integer, uuid, text, text, text, text, text[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_hosted_meetup(uuid, text, text, date, time without time zone, time without time zone, integer, uuid, text, text, text, text, text[], boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.is_allowed_meetup_cover(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_allowed_meetup_cover(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_meetup_cover(text) TO authenticated;