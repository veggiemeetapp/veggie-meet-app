UPDATE public.attendance SET status = 'checked_in'
WHERE meetup_id IN (
  '1e2e8e82-6a42-4b3f-ab07-862d29238e26',
  '38e4ecfa-536c-4608-9bfb-7b44c47a4186',
  '8cc76f1b-c2b2-47fe-a5d6-4bf1a1ea2cad',
  'e7d6963a-7620-49e4-8fc0-29456a34dc18',
  '612e7aa9-70ec-4bcd-8962-3b85e74e6492',
  '82a3d2e7-c6b5-42d5-b521-cb4c90d6ce9d'
)
AND profile_id IN (
  '736bfe2c-c28c-4eff-8c21-f916971769e4',
  '08cfae32-5157-4444-8f67-fb94aa842ef8'
);

UPDATE public.meetups SET date = '2026-08-06'
WHERE id IN (
  '55f0c4f3-a612-42e0-ae82-b461a45623b2',
  '1e2e8e82-6a42-4b3f-ab07-862d29238e26',
  '8cc76f1b-c2b2-47fe-a5d6-4bf1a1ea2cad'
);

UPDATE public.meetups SET date = '2026-08-05'
WHERE id = '38e4ecfa-536c-4608-9bfb-7b44c47a4186';

UPDATE public.meetups SET date = CURRENT_DATE
WHERE id IN (
  'e7d6963a-7620-49e4-8fc0-29456a34dc18',
  '612e7aa9-70ec-4bcd-8962-3b85e74e6492'
);