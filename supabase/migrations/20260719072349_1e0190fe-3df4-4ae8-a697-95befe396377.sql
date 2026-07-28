
-- Enum of supported notification types
CREATE TYPE public.notification_type AS ENUM (
  'connection_request_received',
  'connection_request_accepted',
  'meetup_invitation_received',
  'meetup_invitation_joined',
  'meetup_updated',
  'meetup_cancelled'
);

CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type public.notification_type NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  destination_type TEXT,
  destination_id UUID,
  title TEXT,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, dedup_key)
);

CREATE INDEX notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);
CREATE INDEX notifications_recipient_unread_idx
  ON public.notifications (recipient_id) WHERE read_at IS NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Read own notifications
CREATE POLICY "Users can read own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (recipient_id = public.current_profile_id());

-- Mark own notifications read; cannot change recipient
CREATE POLICY "Users can update read state on own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (recipient_id = public.current_profile_id())
  WITH CHECK (recipient_id = public.current_profile_id());

-- No INSERT/DELETE policies for authenticated -> only service_role/security-definer triggers can write

CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ============================================================
-- Internal helper: insert a notification, ignoring duplicates
-- ============================================================
CREATE OR REPLACE FUNCTION public._insert_notification(
  _recipient uuid,
  _actor uuid,
  _type public.notification_type,
  _entity_type text,
  _entity_id uuid,
  _destination_type text,
  _destination_id uuid,
  _title text,
  _body text,
  _metadata jsonb,
  _dedup_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Never notify self
  IF _actor IS NOT NULL AND _actor = _recipient THEN RETURN; END IF;
  IF _recipient IS NULL THEN RETURN; END IF;

  INSERT INTO public.notifications (
    recipient_id, actor_id, type, entity_type, entity_id,
    destination_type, destination_id, title, body, metadata, dedup_key
  ) VALUES (
    _recipient, _actor, _type, _entity_type, _entity_id,
    _destination_type, _destination_id, _title, _body, COALESCE(_metadata,'{}'::jsonb), _dedup_key
  )
  ON CONFLICT (recipient_id, dedup_key) DO NOTHING;
END;
$$;

-- ============================================================
-- Friendship notifications
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_friendship_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester uuid;
  recipient uuid;
  accepter_name text;
  requester_name text;
BEGIN
  -- Pending request created
  IF TG_OP = 'INSERT' AND NEW.status = 'pending'::friendship_status THEN
    requester := NEW.requester_id;
    recipient := CASE WHEN NEW.profile_a_id = requester THEN NEW.profile_b_id ELSE NEW.profile_a_id END;

    IF requester IS NOT NULL AND recipient IS NOT NULL THEN
      SELECT display_name INTO requester_name FROM public.profiles WHERE id = requester;
      PERFORM public._insert_notification(
        recipient, requester, 'connection_request_received',
        'friendship', NEW.id,
        'network_requests', NULL,
        NULL,
        COALESCE(NULLIF(requester_name,''),'Someone') || ' sent you a connection request.',
        jsonb_build_object('friendship_id', NEW.id),
        'connection-request:' || NEW.id::text || ':received'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Accepted (pending -> connected/verified)
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pending'::friendship_status
     AND NEW.status IN ('connected'::friendship_status, 'verified'::friendship_status) THEN
    requester := OLD.requester_id;
    IF requester IS NOT NULL THEN
      -- accepter = the other participant
      IF requester = NEW.profile_a_id THEN
        recipient := requester;
        SELECT display_name INTO accepter_name FROM public.profiles WHERE id = NEW.profile_b_id;
        PERFORM public._insert_notification(
          requester, NEW.profile_b_id, 'connection_request_accepted',
          'friendship', NEW.id,
          'veggie_profile', NEW.profile_b_id,
          NULL,
          COALESCE(NULLIF(accepter_name,''),'Someone') || ' accepted your connection request.',
          jsonb_build_object('friendship_id', NEW.id),
          'connection-request:' || NEW.id::text || ':accepted'
        );
      ELSE
        SELECT display_name INTO accepter_name FROM public.profiles WHERE id = NEW.profile_a_id;
        PERFORM public._insert_notification(
          requester, NEW.profile_a_id, 'connection_request_accepted',
          'friendship', NEW.id,
          'veggie_profile', NEW.profile_a_id,
          NULL,
          COALESCE(NULLIF(accepter_name,''),'Someone') || ' accepted your connection request.',
          jsonb_build_object('friendship_id', NEW.id),
          'connection-request:' || NEW.id::text || ':accepted'
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER friendship_notify
  AFTER INSERT OR UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.handle_friendship_notification();

-- ============================================================
-- Meetup invitation notifications
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_invitation_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_name text;
  recipient_name text;
  meetup_title text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT display_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
    SELECT title INTO meetup_title FROM public.meetups WHERE id = NEW.meetup_id;
    PERFORM public._insert_notification(
      NEW.recipient_id, NEW.sender_id, 'meetup_invitation_received',
      'meetup_invitation', NEW.id,
      'dm_conversation', NEW.conversation_id,
      NULL,
      COALESCE(NULLIF(sender_name,''),'Someone') || ' invited you to ' || COALESCE(meetup_title,'a Meetup') || '.',
      jsonb_build_object('invitation_id', NEW.id, 'meetup_id', NEW.meetup_id, 'conversation_id', NEW.conversation_id),
      'invitation:' || NEW.id::text || ':received'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = 'joined'
     AND OLD.status IS DISTINCT FROM 'joined' THEN
    SELECT display_name INTO recipient_name FROM public.profiles WHERE id = NEW.recipient_id;
    SELECT title INTO meetup_title FROM public.meetups WHERE id = NEW.meetup_id;
    PERFORM public._insert_notification(
      NEW.sender_id, NEW.recipient_id, 'meetup_invitation_joined',
      'meetup_invitation', NEW.id,
      'dm_conversation', NEW.conversation_id,
      NULL,
      COALESCE(NULLIF(recipient_name,''),'Someone') || ' joined ' || COALESCE(meetup_title,'the Meetup') || ' from your invitation.',
      jsonb_build_object('invitation_id', NEW.id, 'meetup_id', NEW.meetup_id, 'conversation_id', NEW.conversation_id),
      'invitation:' || NEW.id::text || ':joined'
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER meetup_invitation_notify
  AFTER INSERT OR UPDATE ON public.meetup_invitations
  FOR EACH ROW EXECUTE FUNCTION public.handle_invitation_notification();

-- ============================================================
-- Meetup update / cancellation notifications
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_meetup_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attendee RECORD;
  changed_fields text[] := ARRAY[]::text[];
  change_summary text;
  dedup text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  -- Cancellation
  IF NEW.status = 'cancelled'::meetup_status
     AND OLD.status IS DISTINCT FROM 'cancelled'::meetup_status THEN
    dedup := 'meetup:' || NEW.id::text || ':cancelled';
    FOR attendee IN
      SELECT DISTINCT a.profile_id
        FROM public.attendance a
       WHERE a.meetup_id = NEW.id
         AND a.status <> 'cancelled'::attendance_status
         AND a.profile_id <> NEW.host_id
    LOOP
      PERFORM public._insert_notification(
        attendee.profile_id, NEW.host_id, 'meetup_cancelled',
        'meetup', NEW.id,
        'meetup', NEW.id,
        NULL,
        COALESCE(NEW.title,'A Meetup') || ' was cancelled.',
        jsonb_build_object('meetup_id', NEW.id),
        dedup
      );
    END LOOP;
    RETURN NEW;
  END IF;

  -- Meaningful updates (skip when cancelled)
  IF NEW.status = 'cancelled'::meetup_status THEN RETURN NEW; END IF;

  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changed_fields := array_append(changed_fields, 'title');
  END IF;
  IF OLD.date IS DISTINCT FROM NEW.date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time
     OR OLD.end_time IS DISTINCT FROM NEW.end_time THEN
    changed_fields := array_append(changed_fields, 'time');
  END IF;
  IF OLD.community_place_id IS DISTINCT FROM NEW.community_place_id
     OR OLD.custom_location_name IS DISTINCT FROM NEW.custom_location_name
     OR OLD.custom_location_address IS DISTINCT FROM NEW.custom_location_address THEN
    changed_fields := array_append(changed_fields, 'location');
  END IF;

  IF array_length(changed_fields,1) IS NULL THEN RETURN NEW; END IF;

  change_summary := CASE
    WHEN array_length(changed_fields,1) = 1 THEN 'its ' || changed_fields[1]
    WHEN array_length(changed_fields,1) = 2 THEN 'its ' || changed_fields[1] || ' and ' || changed_fields[2]
    ELSE 'its ' || array_to_string(changed_fields[1:array_length(changed_fields,1)-1], ', ') || ', and ' || changed_fields[array_length(changed_fields,1)]
  END;

  -- Stable dedup per updated_at timestamp so one edit = one notification
  dedup := 'meetup:' || NEW.id::text || ':update:' || extract(epoch from NEW.updated_at)::text;

  FOR attendee IN
    SELECT DISTINCT a.profile_id
      FROM public.attendance a
     WHERE a.meetup_id = NEW.id
       AND a.status <> 'cancelled'::attendance_status
       AND a.profile_id <> NEW.host_id
  LOOP
    PERFORM public._insert_notification(
      attendee.profile_id, NEW.host_id, 'meetup_updated',
      'meetup', NEW.id,
      'meetup', NEW.id,
      NULL,
      COALESCE(NEW.title,'A Meetup') || ' changed ' || change_summary || '.',
      jsonb_build_object('meetup_id', NEW.id, 'changed_fields', to_jsonb(changed_fields)),
      dedup
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER meetup_notify
  AFTER UPDATE ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.handle_meetup_notification();

-- ============================================================
-- Mark-all-read RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid; updated int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.notifications
     SET read_at = now()
   WHERE recipient_id = me
     AND read_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;
