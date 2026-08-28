ALTER TABLE public.dm_messages DROP CONSTRAINT dm_body_nonempty;
ALTER TABLE public.dm_messages DROP CONSTRAINT dm_messages_body_or_invitation;

ALTER TABLE public.dm_messages
  ADD CONSTRAINT dm_body_nonempty
  CHECK (deleted_at IS NOT NULL OR length(btrim(body)) > 0);

ALTER TABLE public.dm_messages
  ADD CONSTRAINT dm_messages_body_or_invitation
  CHECK (
    deleted_at IS NOT NULL
    OR invitation_id IS NOT NULL
    OR char_length(btrim(body)) > 0
  );