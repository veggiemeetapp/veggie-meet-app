-- Meetup chat messages: chronological read by chat, and realtime append.
CREATE INDEX IF NOT EXISTS messages_chat_time_idx
  ON public.messages (chat_id, created_at DESC);

-- Attendee lookups scoped to a meetup (Meet-the-Group, Management, capacity).
CREATE INDEX IF NOT EXISTS attendance_meetup_status_idx
  ON public.attendance (meetup_id, status);

-- Host's own meetup calendar (My Plans, Management dashboards).
CREATE INDEX IF NOT EXISTS meetups_host_date_idx
  ON public.meetups (host_id, date);

-- Meetup listings by city + date (Today/Community/Search).
CREATE INDEX IF NOT EXISTS meetups_city_date_status_idx
  ON public.meetups (city_id, date, status);

-- Friendship lookups from either endpoint, focused on active connections.
CREATE INDEX IF NOT EXISTS friendships_profile_a_status_idx
  ON public.friendships (profile_a_id, status);
CREATE INDEX IF NOT EXISTS friendships_profile_b_status_idx
  ON public.friendships (profile_b_id, status);

-- DM messages by conversation, newest first (chat list previews).
-- dm_messages_conv_time_idx already exists; no-op guard for clarity.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'dm_messages_conv_time_idx') THEN
    CREATE INDEX dm_messages_conv_time_idx ON public.dm_messages (conversation_id, created_at DESC);
  END IF;
END $$;