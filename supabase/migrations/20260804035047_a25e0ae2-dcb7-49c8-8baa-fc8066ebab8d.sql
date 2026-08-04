-- 1. New notification type
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'meetup_location_changed';

-- 2. History columns (mode + place lineage); no new coordinate storage
ALTER TABLE public.meetup_location_changes
  ADD COLUMN IF NOT EXISTS old_community_place_id uuid REFERENCES public.community_places(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS new_community_place_id uuid REFERENCES public.community_places(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS old_location_mode text,
  ADD COLUMN IF NOT EXISTS new_location_mode text;
