-- WO-070A DEF-070A-01: cancelled meetups must leave the chat readable (read-only)
-- for everyone who was still going when the host cancelled. cancel_meetup() sets
-- every active attendance row to 'cancelled' with updated_at = cancelled_at, so
-- we can distinguish cancellation-driven rows from voluntary leavers.
CREATE OR REPLACE FUNCTION public.can_read_meetup_chat(_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chats c
    JOIN public.meetups m ON m.id = c.meetup_id
    WHERE c.id = _chat_id
      AND public.current_profile_id() IS NOT NULL
      AND (
        m.host_id = public.current_profile_id()
        OR EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.meetup_id = m.id
            AND a.profile_id = public.current_profile_id()
            AND (
              a.status NOT IN ('cancelled', 'removed')
              OR (
                m.status = 'cancelled'
                AND m.cancelled_at IS NOT NULL
                AND a.status = 'cancelled'
                AND a.updated_at >= m.cancelled_at
              )
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_meetup_chat(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_read_meetup_chat(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_read_meetup_chat(uuid) TO authenticated;