-- WO-041 Reference Data Seed (Production)
-- Idempotent. Safe to rerun. Contains ONLY approved reference data.
-- No profiles, no auth users, no meetups, no attendance, no messages,
-- no notifications, no analytics, no storage objects, no fixtures.
--
-- Runs inside a transaction that ROLLBACKs by default. After reviewing
-- validation output at the bottom, change the final ROLLBACK to COMMIT.

BEGIN;

-- =====================================================================
-- 1. Cities  (5 rows — approved production launch cities)
--    Stable IDs preserved: onboarding, plans, and search reference them
--    via profile_preferences.selected_city_id / home_city_id snapshots.
-- =====================================================================
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

-- =====================================================================
-- 2. Interest catalogue  (12 rows — approved)
--    Stable text IDs preserved: profiles.interests[] stores them verbatim.
-- =====================================================================
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

-- =====================================================================
-- 3. Community Places
--    INTENTIONALLY EMPTY at launch. The preview backend's Community Places
--    are all QA fixtures (WO033A2/probe_/__test_). Real production places
--    are curated post-launch by the owner via authenticated tooling.
-- =====================================================================

-- =====================================================================
-- 4. Meetup categories / notification defaults
--    Not table-backed — enums (meetup_category, notification_type) and
--    per-profile rows (notification_preferences via handle_new_user).
--    No seed required.
-- =====================================================================

-- =====================================================================
-- Validation queries
-- =====================================================================
\echo '--- Row counts ---'
SELECT 'cities' AS table, count(*) FROM public.cities
UNION ALL SELECT 'interest_catalogue', count(*) FROM public.interest_catalogue
UNION ALL SELECT 'community_places', count(*) FROM public.community_places;

\echo '--- Duplicate labels ---'
SELECT 'cities.normalized_name' AS scope, normalized_name, count(*)
  FROM public.cities GROUP BY normalized_name HAVING count(*) > 1;
SELECT 'interests.id' AS scope, id, count(*)
  FROM public.interest_catalogue GROUP BY id HAVING count(*) > 1;

\echo '--- Missing required fields ---'
SELECT id, name FROM public.cities
  WHERE timezone IS NULL OR country_code IS NULL OR normalized_name IS NULL;
SELECT id FROM public.interest_catalogue WHERE label IS NULL OR sort_order IS NULL;

\echo '--- QA / placeholder pattern detection ---'
SELECT id, name FROM public.cities
  WHERE name ~* '(qa|wo-|batch|fixture|probe_|test|__)';
SELECT id, label FROM public.interest_catalogue
  WHERE label ~* '(qa|wo-|batch|fixture|probe_|test|__)';
SELECT id, name FROM public.community_places
  WHERE name ~* '(qa|wo-|wo0|batch|fixture|probe_|test|__)';

\echo 'Change ROLLBACK to COMMIT below after reviewing the output.'
ROLLBACK;
-- COMMIT;
