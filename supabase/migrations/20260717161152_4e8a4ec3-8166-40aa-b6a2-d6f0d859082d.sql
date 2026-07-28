
UPDATE public.profiles SET
  display_name = 'Amy Chen',
  bio = 'Weekend hiker and matcha enthusiast. Always up for a slow coffee.',
  current_city = 'Ho Chi Minh City',
  interests = ARRAY['Coffee','Hiking','Yoga','Vegan Food'],
  avatar_url = 'https://api.dicebear.com/9.x/notionists/svg?seed=amy-qa&backgroundColor=c8e6c9',
  onboarding_completed = true
WHERE auth_user_id = 'b7e3e8dd-e40b-4961-9f02-8d4b3eb2344b';

UPDATE public.profiles SET
  display_name = 'Ben Rivera',
  bio = 'Board games, ramen (veggie broth only), and long walks.',
  current_city = 'Ho Chi Minh City',
  interests = ARRAY['Board Games','Vegan Food','Books','Live Music'],
  avatar_url = 'https://api.dicebear.com/9.x/notionists/svg?seed=ben-qa&backgroundColor=ffe0b2',
  onboarding_completed = true
WHERE auth_user_id = 'e4e4fcb2-a217-46ff-bed4-1c1fa19e9f98';

INSERT INTO public.attendance (profile_id, meetup_id, status)
VALUES
  ('f2d889ee-298a-4008-b77d-fb0b9b024f85', '22222222-2222-4222-8222-222222222201', 'joined'),
  ('361bb039-5a48-445e-87cc-d59e774fa40f', '22222222-2222-4222-8222-222222222201', 'joined')
ON CONFLICT DO NOTHING;
