-- WO-106B backend tests for Today curation mutations.
-- Exercises the real RPCs (set_today_place_state / reorder_today_featured_places /
-- get_today_place_curation) under an impersonated owner JWT claim, asserting the
-- rank CHECK and partial unique index hold after every step.
-- Ends by leaving the owner's intended production curation: BÀ XÃ 1, Filthy Vegan 2.

DO $$
DECLARE
  v_owner uuid;
  v_city uuid;
  p_baxa uuid;
  p_filthy uuid;
  p_ivegan uuid;
  p_zero uuid;
  v_ranks text;
  v_err text;
BEGIN
  SELECT auth_user_id INTO v_owner FROM public.owner_allowlist LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  SELECT id INTO p_baxa FROM public.community_places WHERE name ILIKE 'BÀ XÃ%' LIMIT 1;
  SELECT id INTO p_filthy FROM public.community_places WHERE name ILIKE 'Filthy Vegan%' LIMIT 1;
  SELECT id INTO p_ivegan FROM public.community_places WHERE name ILIKE 'Ivegan%' LIMIT 1;
  SELECT id INTO p_zero FROM public.community_places WHERE name ILIKE 'Zeroism%' LIMIT 1;
  SELECT city_id INTO v_city FROM public.community_places WHERE id = p_baxa;

  -- clean slate
  DELETE FROM public.today_place_curation WHERE city_id = v_city;

  -- 1. zero featured -> feature first place
  PERFORM public.set_today_place_state(p_baxa, 'featured');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 1,
    'first feature must be rank 1';

  -- 2. feature second place
  PERFORM public.set_today_place_state(p_filthy, 'featured');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_filthy) = 2,
    'second feature must be rank 2';

  -- 3. feature third place
  PERFORM public.set_today_place_state(p_ivegan, 'featured');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_ivegan) = 3,
    'third feature must be rank 3';

  -- 4. cap at 3
  BEGIN
    PERFORM public.set_today_place_state(p_zero, 'featured');
    RAISE EXCEPTION 'cap of 3 featured places was not enforced';
  EXCEPTION WHEN others THEN
    IF position('up to 3' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 5. reorder 1<->2
  PERFORM public.reorder_today_featured_places(v_city, ARRAY[p_filthy, p_baxa, p_ivegan]);
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_filthy) = 1
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 2,
    'reorder 1<->2 failed';

  -- 6. reorder 2<->3
  PERFORM public.reorder_today_featured_places(v_city, ARRAY[p_filthy, p_ivegan, p_baxa]);
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 3,
    'reorder 2<->3 failed';

  -- 7. unfeature rank 1 -> remaining renormalize to 1..2
  PERFORM public.set_today_place_state(p_filthy, 'normal');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_ivegan) = 1
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 2,
    'unfeature rank 1 failed';

  -- 8. unfeature middle/last, then hide a featured place
  PERFORM public.set_today_place_state(p_baxa, 'hidden');
  ASSERT (SELECT state FROM public.today_place_curation WHERE community_place_id = p_baxa) = 'hidden'
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) IS NULL,
    'hide featured failed';
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_ivegan) = 1,
    'ranks must renormalize after hiding a featured place';

  -- 9. hide a normal place
  PERFORM public.set_today_place_state(p_filthy, 'hidden');
  ASSERT (SELECT state FROM public.today_place_curation WHERE community_place_id = p_filthy) = 'hidden',
    'hide normal failed';

  -- 10. restore hidden
  PERFORM public.set_today_place_state(p_baxa, 'normal');
  ASSERT (SELECT state FROM public.today_place_curation WHERE community_place_id = p_baxa) = 'normal'
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) IS NULL,
    'restore hidden failed';

  -- 11. no duplicate ranks / rank invariant always valid
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.today_place_curation
    WHERE city_id = v_city AND state = 'featured'
    GROUP BY featured_rank HAVING count(*) > 1), 'duplicate featured ranks';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.today_place_curation
    WHERE (state = 'featured' AND (featured_rank IS NULL OR featured_rank < 1))
       OR (state <> 'featured' AND featured_rank IS NOT NULL)), 'rank invariant violated';

  -- 12. non-owner denied
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.set_today_place_state(p_baxa, 'featured');
    RAISE EXCEPTION 'non-owner was allowed to curate';
  EXCEPTION WHEN others THEN
    IF position('Not authorized' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- Final: owner's intended production configuration.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  DELETE FROM public.today_place_curation WHERE city_id = v_city;
  PERFORM public.set_today_place_state(p_baxa, 'featured');
  PERFORM public.set_today_place_state(p_filthy, 'featured');

  SELECT string_agg(cp.name || '=' || t.featured_rank, ', ' ORDER BY t.featured_rank)
    INTO v_ranks
  FROM public.today_place_curation t JOIN public.community_places cp ON cp.id = t.community_place_id
  WHERE t.city_id = v_city AND t.state = 'featured';

  RAISE NOTICE 'WO-106B backend tests passed. Final featured: %', v_ranks;
END $$;
