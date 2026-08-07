REVOKE ALL ON FUNCTION public.complete_hosted_meetup(uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.get_meetup_lifecycle(uuid) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.guard_completed_meetup_immutable() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.guard_meetup_completions_append_only() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_hosted_meetup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_meetup_lifecycle(uuid) TO authenticated;