REVOKE EXECUTE ON FUNCTION public.send_meetup_invitations(uuid, uuid[], text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_meetup_invite_candidates(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_meetup_invite_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meetup_invite_candidates(uuid) TO authenticated;