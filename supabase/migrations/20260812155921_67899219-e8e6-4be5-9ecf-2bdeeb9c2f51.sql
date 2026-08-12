DROP POLICY IF EXISTS meetup_invitations_participant_select ON public.meetup_invitations;
CREATE POLICY meetup_invitations_participant_select
ON public.meetup_invitations
FOR SELECT
TO authenticated
USING ((sender_id = current_profile_id()) OR (recipient_id = current_profile_id()));