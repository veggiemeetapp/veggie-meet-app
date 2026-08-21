-- WO-124A: canonical taxonomy finalisation (idempotent, order-safe)

-- 1) Ensure every canonical interest exists with the approved grouping.
WITH t(id, label, group_key, group_label, group_sort, sort_order) AS (
  VALUES
    ('vegan_food','Vegan Food','food_social','Food & Social',1,1),
    ('dining_out','Dining Out','food_social','Food & Social',1,2),
    ('coffee','Coffee','food_social','Food & Social',1,3),
    ('tea','Tea','food_social','Food & Social',1,4),
    ('cooking','Cooking','food_social','Food & Social',1,5),
    ('street_food','Street Food','food_social','Food & Social',1,6),
    ('plant_nutrition','Plant-Based Nutrition','food_social','Food & Social',1,7),
    ('live_music','Live Music','culture_entertainment','Culture & Entertainment',2,1),
    ('art_museums','Art & Museums','culture_entertainment','Culture & Entertainment',2,2),
    ('films','Films','culture_entertainment','Culture & Entertainment',2,3),
    ('reading','Reading','culture_entertainment','Culture & Entertainment',2,4),
    ('photography','Photography','culture_entertainment','Culture & Entertainment',2,5),
    ('crafts_diy','Crafts & DIY','culture_entertainment','Culture & Entertainment',2,6),
    ('board_games','Board Games','culture_entertainment','Culture & Entertainment',2,7),
    ('writing','Writing','culture_entertainment','Culture & Entertainment',2,8),
    ('workshops','Workshops','culture_entertainment','Culture & Entertainment',2,9),
    ('parks_picnics','Parks & Picnics','outdoors_adventure','Outdoors & Adventure',3,1),
    ('gardening','Gardening','outdoors_adventure','Outdoors & Adventure',3,2),
    ('beaches','Beaches','outdoors_adventure','Outdoors & Adventure',3,3),
    ('camping','Camping','outdoors_adventure','Outdoors & Adventure',3,4),
    ('hiking','Hiking','outdoors_adventure','Outdoors & Adventure',3,5),
    ('walking','Walking','outdoors_adventure','Outdoors & Adventure',3,6),
    ('animal_welfare','Animal Welfare','outdoors_adventure','Outdoors & Adventure',3,7),
    ('yoga','Yoga','sports_wellness','Sports & Wellness',4,1),
    ('fitness','Fitness','sports_wellness','Sports & Wellness',4,2),
    ('running','Running','sports_wellness','Sports & Wellness',4,3),
    ('cycling','Cycling','sports_wellness','Sports & Wellness',4,4),
    ('swimming','Swimming','sports_wellness','Sports & Wellness',4,5),
    ('meditation','Meditation','sports_wellness','Sports & Wellness',4,6),
    ('travel','Travel','travel_learning','Travel & Learning',5,1),
    ('languages','Languages','travel_learning','Travel & Learning',5,2),
    ('tech','Tech','travel_learning','Travel & Learning',5,3),
    ('volunteering','Volunteering','community_purpose','Community & Purpose',6,1),
    ('sustainability','Sustainability','community_purpose','Community & Purpose',6,2),
    ('activism','Activism','community_purpose','Community & Purpose',6,3)
)
INSERT INTO public.interest_catalogue (id, label, group_key, group_label, group_sort, sort_order, active)
SELECT id, label, group_key, group_label, group_sort, sort_order, true FROM t
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      group_key   = EXCLUDED.group_key,
      group_label = EXCLUDED.group_label,
      group_sort  = EXCLUDED.group_sort,
      sort_order  = EXCLUDED.sort_order,
      active      = true;

-- 2) Retire Baking (not part of the approved list) without discarding member data:
--    the row is kept inactive and legacy values map to Cooking.
UPDATE public.interest_catalogue SET active = false WHERE id = 'baking';

INSERT INTO public.interest_legacy_map (legacy_key, interest_id)
VALUES ('baking','cooking')
ON CONFLICT (legacy_key) DO UPDATE SET interest_id = EXCLUDED.interest_id;

-- 3) Any member who had Baking keeps an equivalent canonical value.
UPDATE public.profiles
   SET interests = public.canonical_interest_labels(interests),
       updated_at = now()
 WHERE EXISTS (
   SELECT 1 FROM unnest(COALESCE(interests,'{}'::text[])) AS x(v)
   WHERE lower(btrim(v)) IN ('baking')
 );

-- 4) Established profiles may save fewer than 3 interests (including none).
--    New-member onboarding still requires 3 (enforced by complete_onboarding).
CREATE OR REPLACE FUNCTION public.normalize_interests(_interests text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids   text[];
  v_bad   text;
BEGIN
  IF _interests IS NULL THEN RETURN NULL; END IF;

  SELECT btrim(c) INTO v_bad
  FROM unnest(_interests) AS c
  WHERE btrim(COALESCE(c,'')) <> ''
    AND public.resolve_interest_id(c) IS NULL
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unsupported interest: %', v_bad USING ERRCODE = '22023';
  END IF;

  v_ids := public.canonical_interest_ids(_interests);

  IF COALESCE(array_length(v_ids, 1), 0) > 20 THEN
    RAISE EXCEPTION 'pick at most 20 interests' USING ERRCODE = '22023';
  END IF;

  RETURN public.canonical_interest_labels(_interests);
END $function$;

REVOKE ALL ON FUNCTION public.normalize_interests(text[]) FROM PUBLIC, anon, authenticated;