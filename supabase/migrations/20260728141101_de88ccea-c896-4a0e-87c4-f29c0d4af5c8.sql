-- WO-041 Reference Data Seed (Production) — approved reference data only
INSERT INTO public.cities
  (id, name, normalized_name, country_code, country_name, timezone, latitude, longitude, is_active)
VALUES
  ('22c5e005-d93b-4f33-8ccd-34ba2f2c1c5e','Bangkok','bangkok','TH','Thailand','Asia/Bangkok',13.7563,100.5018,true),
  ('745a7caa-410e-477a-831d-4ea9884ff20c','Da Nang','da-nang','VN','Vietnam','Asia/Ho_Chi_Minh',16.0544,108.2022,true),
  ('dddef286-9a54-4efc-bf93-abd4c4e819b4','Hanoi','hanoi','VN','Vietnam','Asia/Ho_Chi_Minh',21.0278,105.8342,true),
  ('989d4e2b-c385-4216-8cd0-5f4281e4663a','Ho Chi Minh City','ho-chi-minh-city','VN','Vietnam','Asia/Ho_Chi_Minh',10.7769,106.7009,true),
  ('2f63d2bc-e0eb-4f06-822f-d6b456e4e804','Singapore','singapore','SG','Singapore','Asia/Singapore',1.3521,103.8198,true)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      normalized_name = EXCLUDED.normalized_name,
      country_code = EXCLUDED.country_code,
      country_name = EXCLUDED.country_name,
      timezone = EXCLUDED.timezone,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      is_active = EXCLUDED.is_active,
      updated_at = now();

INSERT INTO public.interest_catalogue (id, label, category, active, sort_order) VALUES
  ('coffee',        'Coffee',         'food',      true,  10),
  ('vegan_food',    'Vegan Food',     'food',      true,  20),
  ('cooking',       'Cooking',        'food',      true,  30),
  ('hiking',        'Hiking',         'outdoor',   true,  40),
  ('yoga',          'Yoga',           'wellness',  true,  50),
  ('fitness',       'Fitness',        'wellness',  true,  60),
  ('books',         'Books',          'culture',   true,  70),
  ('live_music',    'Live Music',     'culture',   true,  80),
  ('board_games',   'Board Games',    'social',    true,  90),
  ('travel',        'Travel',         'lifestyle', true, 100),
  ('volunteering',  'Volunteering',   'community', true, 110),
  ('sustainability','Sustainability', 'community', true, 120)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      active = EXCLUDED.active,
      sort_order = EXCLUDED.sort_order;