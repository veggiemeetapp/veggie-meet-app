-- DEF-062-01: hosts could write Meetup location snapshot columns directly via the
-- Data API. All Meetup mutations already go through SECURITY DEFINER RPCs
-- (update_hosted_meetup, update_meetup_location, cancel_meetup,
-- accept_meetup_current_place_location), so table-level write access is removed.
REVOKE UPDATE, DELETE ON public.meetups FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.meetups FROM PUBLIC;