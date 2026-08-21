-- WO-124B: correct the canonical interest taxonomy to the authoritative 35.

-- 1) Upsert the authoritative 35 canonical interests.
INSERT INTO public.interest_catalogue (id, label, group_key, group_label, group_sort, sort_order, active) VALUES
  ('vegan_food','Vegan Food','food_social','Food & Social',1,1,true),
  ('coffee','Coffee','food_social','Food & Social',1,2,true),
  ('cooking','Cooking','food_social','Food & Social',1,3,true),
  ('dining_out','Dining Out','food_social','Food & Social',1,4,true),
  ('food_markets','Food Markets','food_social','Food & Social',1,5,true),
  ('food_tours','Food Tours','food_social','Food & Social',1,6,true),
  ('picnics','Picnics','food_social','Food & Social',1,7,true),
  ('live_music','Live Music','culture_entertainment','Culture & Entertainment',2,1,true),
  ('dancing','Dancing','culture_entertainment','Culture & Entertainment',2,2,true),
  ('festivals','Festivals','culture_entertainment','Culture & Entertainment',2,3,true),
  ('comedy','Comedy','culture_entertainment','Culture & Entertainment',2,4,true),
  ('film','Film','culture_entertainment','Culture & Entertainment',2,5,true),
  ('art_museums','Art & Museums','culture_entertainment','Culture & Entertainment',2,6,true),
  ('photography','Photography','culture_entertainment','Culture & Entertainment',2,7,true),
  ('reading','Reading','culture_entertainment','Culture & Entertainment',2,8,true),
  ('karaoke','Karaoke','culture_entertainment','Culture & Entertainment',2,9,true),
  ('hiking','Hiking','outdoors_adventure','Outdoors & Adventure',3,1,true),
  ('walking','Walking','outdoors_adventure','Outdoors & Adventure',3,2,true),
  ('running','Running','outdoors_adventure','Outdoors & Adventure',3,3,true),
  ('cycling','Cycling','outdoors_adventure','Outdoors & Adventure',3,4,true),
  ('climbing','Climbing','outdoors_adventure','Outdoors & Adventure',3,5,true),
  ('camping','Camping','outdoors_adventure','Outdoors & Adventure',3,6,true),
  ('park_days','Park Days','outdoors_adventure','Outdoors & Adventure',3,7,true),
  ('yoga','Yoga','sports_wellness','Sports & Wellness',4,1,true),
  ('pilates','Pilates','sports_wellness','Sports & Wellness',4,2,true),
  ('meditation','Meditation','sports_wellness','Sports & Wellness',4,3,true),
  ('fitness','Fitness','sports_wellness','Sports & Wellness',4,4,true),
  ('team_sports','Team Sports','sports_wellness','Sports & Wellness',4,5,true),
  ('racquet_sports','Racquet Sports','sports_wellness','Sports & Wellness',4,6,true),
  ('travel','Travel','travel_learning','Travel & Learning',5,1,true),
  ('language_exchange','Language Exchange','travel_learning','Travel & Learning',5,2,true),
  ('workshops_learning','Workshops & Learning','travel_learning','Travel & Learning',5,3,true),
  ('board_games','Board Games','community_purpose','Community & Purpose',6,1,true),
  ('volunteering','Volunteering','community_purpose','Community & Purpose',6,2,true),
  ('sustainability','Sustainability','community_purpose','Community & Purpose',6,3,true)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  group_key = EXCLUDED.group_key,
  group_label = EXCLUDED.group_label,
  group_sort = EXCLUDED.group_sort,
  sort_order = EXCLUDED.sort_order,
  active = true;

-- 2) Retire every non-canonical row (preserved, never deleted).
UPDATE public.interest_catalogue SET active = false
WHERE active AND id NOT IN (
  'vegan_food','coffee','cooking','dining_out','food_markets','food_tours','picnics',
  'live_music','dancing','festivals','comedy','film','art_museums','photography','reading','karaoke',
  'hiking','walking','running','cycling','climbing','camping','park_days',
  'yoga','pilates','meditation','fitness','team_sports','racquet_sports',
  'travel','language_exchange','workshops_learning',
  'board_games','volunteering','sustainability'
);

-- 3) Legacy resolution: deterministic display-name corrections only.
INSERT INTO public.interest_legacy_map (legacy_key, interest_id) VALUES
  ('books','reading'),
  ('book club','reading'),
  ('films','film'),
  ('movies','film'),
  ('film','film'),
  ('languages','language_exchange'),
  ('workshops','workshops_learning'),
  ('workshop','workshops_learning'),
  ('picnic','picnics'),
  ('picnics','picnics'),
  ('parks & picnics','picnics'),
  ('park day','park_days'),
  ('baking','cooking')
ON CONFLICT (legacy_key) DO UPDATE SET interest_id = EXCLUDED.interest_id;

-- 4) Historical selections must stay resolvable even when retired.
CREATE OR REPLACE FUNCTION public.resolve_interest_id(_value text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ic.id FROM public.interest_catalogue ic
      WHERE ic.active AND lower(ic.id) = lower(btrim(_value)) LIMIT 1),
    (SELECT ic.id FROM public.interest_catalogue ic
      WHERE ic.active AND lower(ic.label) = lower(btrim(_value)) LIMIT 1),
    (SELECT lm.interest_id FROM public.interest_legacy_map lm
      JOIN public.interest_catalogue ic ON ic.id = lm.interest_id AND ic.active
      WHERE lm.legacy_key = lower(btrim(_value)) LIMIT 1),
    -- WO-124B: retired values remain resolvable so no saved selection is lost.
    (SELECT ic.id FROM public.interest_catalogue ic
      WHERE lower(ic.id) = lower(btrim(_value)) LIMIT 1),
    (SELECT ic.id FROM public.interest_catalogue ic
      WHERE lower(ic.label) = lower(btrim(_value)) LIMIT 1),
    (SELECT lm.interest_id FROM public.interest_legacy_map lm
      WHERE lm.legacy_key = lower(btrim(_value)) LIMIT 1)
  )
$function$;

-- 5) Meetups tagged with a now-retired interest stay valid and editable;
--    only newly chosen tags must come from the active catalogue.
CREATE OR REPLACE FUNCTION public.validate_meetup_interest_tags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE bad text;
BEGIN
  NEW.additional_interest_ids := COALESCE(NEW.additional_interest_ids, '{}'::text[]);

  IF NEW.primary_interest_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.interest_catalogue
                    WHERE id = NEW.primary_interest_id
                      AND (active OR (TG_OP = 'UPDATE'
                                      AND OLD.primary_interest_id IS NOT DISTINCT FROM NEW.primary_interest_id))) THEN
      RAISE EXCEPTION 'unsupported primary interest: %', NEW.primary_interest_id
        USING ERRCODE = '22023';
    END IF;
  ELSIF array_length(NEW.additional_interest_ids, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'a primary interest is required before additional interests'
      USING ERRCODE = '22023';
  END IF;

  IF array_length(NEW.additional_interest_ids, 1) > 2 THEN
    RAISE EXCEPTION 'at most 2 additional interests' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(NEW.additional_interest_ids) x)
     <> COALESCE(array_length(NEW.additional_interest_ids, 1), 0) THEN
    RAISE EXCEPTION 'additional interests must be distinct' USING ERRCODE = '22023';
  END IF;

  IF NEW.primary_interest_id = ANY(NEW.additional_interest_ids) THEN
    RAISE EXCEPTION 'additional interests cannot repeat the primary interest'
      USING ERRCODE = '22023';
  END IF;

  SELECT x INTO bad FROM unnest(NEW.additional_interest_ids) x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.interest_catalogue
     WHERE id = x
       AND (active OR (TG_OP = 'UPDATE' AND x = ANY(COALESCE(OLD.additional_interest_ids,'{}'::text[]))))
  ) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'unsupported additional interest: %', bad USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END $function$;

-- 6) Re-canonicalise stored profile labels (retired values are preserved as their
--    own retired label; nothing is dropped).
UPDATE public.profiles p
   SET interests = public.canonical_interest_labels(p.interests)
 WHERE p.interests IS NOT NULL
   AND p.interests IS DISTINCT FROM public.canonical_interest_labels(p.interests);
