CREATE OR REPLACE FUNCTION public.reconcile_invitations_on_join(_meetup_id uuid, _profile_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.meetup_invitations
     SET status = 'joined'::invitation_status,
         joined_at = COALESCE(joined_at, now()),
         viewed_at = COALESCE(viewed_at, now())
   WHERE meetup_id = _meetup_id
     AND recipient_id = _profile_id
     AND status IN ('invited'::invitation_status, 'viewed'::invitation_status);
$function$;

REVOKE ALL ON FUNCTION public.reconcile_invitations_on_join(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_invitations_on_join(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_invitations_on_join(uuid, uuid) FROM authenticated;

-- Backfill: any already-attending recipient with a stale open invitation.
UPDATE public.meetup_invitations i
   SET status = 'joined'::invitation_status,
       joined_at = COALESCE(i.joined_at, now()),
       viewed_at = COALESCE(i.viewed_at, now())
 WHERE i.status IN ('invited'::invitation_status, 'viewed'::invitation_status)
   AND EXISTS (
     SELECT 1 FROM public.attendance a
      WHERE a.meetup_id = i.meetup_id
        AND a.profile_id = i.recipient_id
        AND a.status::text NOT IN ('cancelled','removed')
   );