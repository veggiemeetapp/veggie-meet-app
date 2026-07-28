
-- Meetup Invitations schema
CREATE TYPE public.invitation_status AS ENUM ('invited','viewed','joined');

CREATE TABLE public.meetup_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id uuid NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.dm_conversations(id) ON DELETE CASCADE,
  personal_message text NOT NULL DEFAULT '',
  status public.invitation_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  joined_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitation_sender_not_recipient CHECK (sender_id <> recipient_id),
  CONSTRAINT invitation_personal_message_len CHECK (char_length(personal_message) <= 300)
);

CREATE UNIQUE INDEX meetup_invitations_triple_uniq
  ON public.meetup_invitations (meetup_id, sender_id, recipient_id);
CREATE INDEX meetup_invitations_conversation_idx
  ON public.meetup_invitations (conversation_id, created_at DESC);
CREATE INDEX meetup_invitations_recipient_idx
  ON public.meetup_invitations (recipient_id, status);

GRANT SELECT, INSERT, UPDATE ON public.meetup_invitations TO authenticated;
GRANT ALL ON public.meetup_invitations TO service_role;

ALTER TABLE public.meetup_invitations ENABLE ROW LEVEL SECURITY;

-- Read: only sender or recipient
CREATE POLICY meetup_invitations_participant_select
  ON public.meetup_invitations FOR SELECT
  USING (
    sender_id = public.current_profile_id()
    OR recipient_id = public.current_profile_id()
  );

-- Insert path is via RPC (SECURITY DEFINER). We still allow direct insert
-- by the sender, but enforce eligibility with a trigger.
CREATE POLICY meetup_invitations_sender_insert
  ON public.meetup_invitations FOR INSERT
  WITH CHECK (sender_id = public.current_profile_id());

-- Recipient can update (viewed/joined). Sender may not edit after send.
CREATE POLICY meetup_invitations_recipient_update
  ON public.meetup_invitations FOR UPDATE
  USING (recipient_id = public.current_profile_id())
  WITH CHECK (recipient_id = public.current_profile_id());

CREATE TRIGGER meetup_invitations_updated_at
BEFORE UPDATE ON public.meetup_invitations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enforce all invitation rules on insert.
CREATE OR REPLACE FUNCTION public.enforce_meetup_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  conv RECORD;
  attending_recipient boolean;
  attendee_count int;
  sender_attending boolean;
BEGIN
  SELECT id, host_id, status, date, start_time, capacity
    INTO m FROM public.meetups WHERE id = NEW.meetup_id;
  IF m IS NULL THEN
    RAISE EXCEPTION 'Meetup not found';
  END IF;
  IF m.status <> 'upcoming' THEN
    RAISE EXCEPTION 'Meetup is no longer accepting invitations';
  END IF;
  IF (m.date + m.start_time) < now() THEN
    RAISE EXCEPTION 'Meetup has already started';
  END IF;

  -- Sender must be host or confirmed attendee
  IF m.host_id = NEW.sender_id THEN
    sender_attending := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.attendance
      WHERE profile_id = NEW.sender_id
        AND meetup_id = NEW.meetup_id
        AND status <> 'cancelled'
    ) INTO sender_attending;
  END IF;
  IF NOT sender_attending THEN
    RAISE EXCEPTION 'You must be hosting or attending this Meetup to invite';
  END IF;

  -- Must be connected/verified
  IF NOT public.are_connected(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'You can only invite connected Veggies';
  END IF;

  -- No blocks either direction
  IF public.is_blocked_between(NEW.sender_id, NEW.recipient_id) THEN
    RAISE EXCEPTION 'Messaging is not available';
  END IF;

  -- Recipient must not already be attending
  SELECT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = NEW.recipient_id
      AND meetup_id = NEW.meetup_id
      AND status <> 'cancelled'
  ) INTO attending_recipient;
  IF attending_recipient THEN
    RAISE EXCEPTION 'Recipient is already attending';
  END IF;

  -- Not full
  SELECT count(*) INTO attendee_count
    FROM public.attendance WHERE meetup_id = NEW.meetup_id AND status <> 'cancelled';
  IF attendee_count >= m.capacity THEN
    RAISE EXCEPTION 'Meetup is full';
  END IF;

  -- Conversation must belong to this pair
  SELECT user_a_id, user_b_id INTO conv
    FROM public.dm_conversations WHERE id = NEW.conversation_id;
  IF conv IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF NOT (
    (conv.user_a_id = NEW.sender_id AND conv.user_b_id = NEW.recipient_id)
    OR (conv.user_a_id = NEW.recipient_id AND conv.user_b_id = NEW.sender_id)
  ) THEN
    RAISE EXCEPTION 'Conversation does not match sender/recipient';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_meetup_invitation
BEFORE INSERT ON public.meetup_invitations
FOR EACH ROW EXECUTE FUNCTION public.enforce_meetup_invitation();

-- Add invitation link to dm_messages so we can render invitation cards inline.
ALTER TABLE public.dm_messages
  ADD COLUMN invitation_id uuid REFERENCES public.meetup_invitations(id) ON DELETE SET NULL;

-- Allow empty body when the message carries an invitation card.
ALTER TABLE public.dm_messages
  DROP CONSTRAINT IF EXISTS dm_messages_body_check;
ALTER TABLE public.dm_messages
  ADD CONSTRAINT dm_messages_body_or_invitation
  CHECK (invitation_id IS NOT NULL OR char_length(btrim(body)) > 0);

-- RPC: create an invitation atomically (also posts a dm_message pointing at it).
CREATE OR REPLACE FUNCTION public.create_meetup_invitation(
  _meetup_id uuid,
  _recipient_id uuid,
  _personal_message text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid;
  conv_id uuid;
  invitation_id uuid;
  existing_id uuid;
  clean_msg text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _recipient_id = me THEN RAISE EXCEPTION 'Invalid recipient'; END IF;

  clean_msg := COALESCE(btrim(_personal_message), '');
  IF char_length(clean_msg) > 300 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;
  IF clean_msg = '' THEN
    clean_msg := 'Want to join me for this Meetup?';
  END IF;

  -- Reuse duplicate-invitation check for a friendly error.
  SELECT id INTO existing_id FROM public.meetup_invitations
    WHERE meetup_id = _meetup_id AND sender_id = me AND recipient_id = _recipient_id;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'You already invited this Veggie to this Meetup';
  END IF;

  conv_id := public.get_or_create_dm(_recipient_id);

  INSERT INTO public.meetup_invitations
    (meetup_id, sender_id, recipient_id, conversation_id, personal_message)
  VALUES (_meetup_id, me, _recipient_id, conv_id, clean_msg)
  RETURNING id INTO invitation_id;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body, invitation_id)
  VALUES (conv_id, me, clean_msg, invitation_id);

  RETURN invitation_id;
END;
$$;

-- RPC: recipient marks invitation viewed (idempotent).
CREATE OR REPLACE FUNCTION public.mark_invitation_viewed(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; inv RECORD;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO inv FROM public.meetup_invitations WHERE id = _invitation_id;
  IF inv IS NULL OR inv.recipient_id <> me THEN RETURN; END IF;
  IF inv.status = 'invited' THEN
    UPDATE public.meetup_invitations
       SET status = 'viewed', viewed_at = COALESCE(viewed_at, now())
     WHERE id = _invitation_id;
  END IF;
END;
$$;

-- RPC: recipient joins meetup from invitation (rechecks eligibility).
CREATE OR REPLACE FUNCTION public.join_from_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid; inv RECORD; m RECORD; attendee_count int; already boolean;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO inv FROM public.meetup_invitations WHERE id = _invitation_id;
  IF inv IS NULL OR inv.recipient_id <> me THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  SELECT * INTO m FROM public.meetups WHERE id = inv.meetup_id;
  IF m IS NULL THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status = 'cancelled' THEN RAISE EXCEPTION 'Meetup cancelled'; END IF;
  IF (m.date + m.start_time) < now() THEN RAISE EXCEPTION 'Meetup has ended'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance
    WHERE profile_id = me AND meetup_id = inv.meetup_id AND status <> 'cancelled'
  ) INTO already;

  IF NOT already THEN
    SELECT count(*) INTO attendee_count
      FROM public.attendance WHERE meetup_id = inv.meetup_id AND status <> 'cancelled';
    IF attendee_count >= m.capacity THEN
      RAISE EXCEPTION 'Meetup is full';
    END IF;
    INSERT INTO public.attendance (profile_id, meetup_id, status)
      VALUES (me, inv.meetup_id, 'joined')
      ON CONFLICT (profile_id, meetup_id) DO NOTHING;
  END IF;

  UPDATE public.meetup_invitations
     SET status = 'joined',
         joined_at = COALESCE(joined_at, now()),
         viewed_at = COALESCE(viewed_at, now())
   WHERE id = _invitation_id;
END;
$$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.meetup_invitations;
