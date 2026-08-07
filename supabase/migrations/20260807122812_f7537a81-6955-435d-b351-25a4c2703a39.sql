UPDATE public.attendance SET status = 'checked_in'
WHERE meetup_id = '59072be1-687d-4f8b-82c8-e67fc5c7baaa'
  AND profile_id = '736bfe2c-c28c-4eff-8c21-f916971769e4';

UPDATE public.meetups SET date = '2026-08-06'
WHERE id = '59072be1-687d-4f8b-82c8-e67fc5c7baaa';