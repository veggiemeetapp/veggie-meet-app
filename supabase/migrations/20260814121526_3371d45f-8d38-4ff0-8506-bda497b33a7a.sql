DO $$
DECLARE
  v_owner uuid;
  v_city uuid;
  p_baxa uuid;
  p_filthy uuid;
  p_ivegan uuid;
  p_zero uuid;
  v_ranks text;
BEGIN
  SELECT auth_user_id INTO v_owner FROM public.owner_allowlist LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  SELECT id INTO p_baxa FROM public.community_places WHERE name ILIKE 'BÀ XÃ%' LIMIT 1;
  SELECT id INTO p_filthy FROM public.community_places WHERE name ILIKE 'Filthy Vegan%' LIMIT 1;
  SELECT id INTO p_ivegan FROM public.community_places WHERE name ILIKE 'Ivegan%' LIMIT 1;
  SELECT id INTO p_zero FROM public.community_places WHERE name ILIKE 'Zeroism%' LIMIT 1;
  SELECT city_id INTO v_city FROM public.community_places WHERE id = p_baxa;

  DELETE FROM public.today_place_curation WHERE city_id = v_city;

  PERFORM public.set_today_place_state(p_baxa, 'featured');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 1,
    'first feature must be rank 1';

  PERFORM public.set_today_place_state(p_filthy, 'featured');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_filthy) = 2,
    'second feature must be rank 2';

  PERFORM public.set_today_place_state(p_ivegan, 'featured');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_ivegan) = 3,
    'third feature must be rank 3';

  BEGIN
    PERFORM public.set_today_place_state(p_zero, 'featured');
    RAISE EXCEPTION 'cap of 3 featured places was not enforced';
  EXCEPTION WHEN others THEN
    IF position('up to 3' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM public.reorder_today_featured_places(v_city, ARRAY[p_filthy, p_baxa, p_ivegan]);
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_filthy) = 1
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 2,
    'reorder 1<->2 failed';

  PERFORM public.reorder_today_featured_places(v_city, ARRAY[p_filthy, p_ivegan, p_baxa]);
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 3,
    'reorder 2<->3 failed';

  PERFORM public.set_today_place_state(p_filthy, 'normal');
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_ivegan) = 1
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) = 2,
    'unfeature rank 1 failed';

  PERFORM public.set_today_place_state(p_baxa, 'hidden');
  ASSERT (SELECT state FROM public.today_place_curation WHERE community_place_id = p_baxa) = 'hidden'
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) IS NULL,
    'hide featured failed';
  ASSERT (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_ivegan) = 1,
    'ranks must renormalize after hiding a featured place';

  PERFORM public.set_today_place_state(p_filthy, 'hidden');
  ASSERT (SELECT state FROM public.today_place_curation WHERE community_place_id = p_filthy) = 'hidden',
    'hide normal failed';

  PERFORM public.set_today_place_state(p_baxa, 'normal');
  ASSERT (SELECT state FROM public.today_place_curation WHERE community_place_id = p_baxa) = 'normal'
     AND (SELECT featured_rank FROM public.today_place_curation WHERE community_place_id = p_baxa) IS NULL,
    'restore hidden failed';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.today_place_curation
    WHERE city_id = v_city AND state = 'featured'
    GROUP BY featured_rank HAVING count(*) > 1), 'duplicate featured ranks';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.today_place_curation
    WHERE (state = 'featured' AND (featured_rank IS NULL OR featured_rank < 1))
       OR (state <> 'featured' AND featured_rank IS NOT NULL)), 'rank invariant violated';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.set_today_place_state(p_baxa, 'featured');
    RAISE EXCEPTION 'non-owner was allowed to curate';
  EXCEPTION WHEN others THEN
    IF position('Not authorized' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

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
