-- WO-058B: one-time removal of controlled WO-058/WO-058A QA audit records.
-- No general-purpose delete capability is created. No grants change.

DO $$
DECLARE
  v_reviews uuid[] := ARRAY[
    '3b429970-3600-451a-bc7f-063f2582300b',
    'd84468b5-098f-49a2-a9a4-ba858b182f6f',
    'cbdaee26-76b6-44cb-91e6-e0353bfcc234',
    'c3357c05-c69f-4c48-aaa9-60b8321af8ce',
    '059597d3-1aae-4d41-a5e0-7e588e26e387',
    '0f2ef753-7158-4d12-be87-5506607019f4'
  ]::uuid[];
  v_class uuid[] := ARRAY[
    'f4d1cdbc-9ea3-474d-8769-90d15ca3b545',
    '6911428d-c193-424f-aba0-ae1a50f94c7c',
    'd6dcd7eb-2b60-414c-a7a8-5368c5cf7e8f',
    'bba26e3e-fbf4-4a70-af16-0a8dcbfcb42e',
    '06953bad-be8c-487a-a48d-456389ed3f97'
  ]::uuid[];
  v_status uuid[] := ARRAY[
    '5afd1453-e953-46e4-834e-eddb9bbdc847',
    '90941ad0-4f57-41d6-b37d-51fe82467e4d',
    '3cfbc8a6-a977-435a-973d-ad5a68313025'
  ]::uuid[];
  v_analytics uuid[] := ARRAY[
    '0f913e94-e2b5-4e1c-8144-16d7fc94ac4d',
    '2b52df25-d193-4af8-aa12-2f65053512e6',
    '54760d1c-636b-49aa-b6f8-011f8f0bacc4'
  ]::uuid[];
  v_place uuid := '0deae6cc-253e-487d-a5e0-926c9d850d13';
  v_profile uuid := '447dad9b-88fa-4fe4-91c3-97ae29b04d6c';
  v_probe_review uuid;
  v_probe_class uuid;
  v_n integer;
  v_blocked boolean;
BEGIN
  -- 1. Temporarily bypass append-only protections (this migration only).
  ALTER TABLE public.community_place_vegan_reviews DISABLE TRIGGER community_place_vegan_reviews_immutable;
  ALTER TABLE public.community_place_vegan_classification_history DISABLE TRIGGER community_place_vegan_class_history_append_only;

  -- 2. Delete only the exact identified QA rows (children first).
  DELETE FROM public.community_place_vegan_classification_history WHERE id = ANY(v_class);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 5 THEN RAISE EXCEPTION 'WO-058B: expected 5 classification-history rows, removed %', v_n; END IF;

  DELETE FROM public.community_place_vegan_reviews WHERE id = ANY(v_reviews);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 6 THEN RAISE EXCEPTION 'WO-058B: expected 6 vegan-review rows, removed %', v_n; END IF;

  DELETE FROM public.community_place_status_history WHERE id = ANY(v_status);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 3 THEN RAISE EXCEPTION 'WO-058B: expected 3 status-history rows, removed %', v_n; END IF;

  DELETE FROM public.analytics_events WHERE id = ANY(v_analytics);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 3 THEN RAISE EXCEPTION 'WO-058B: expected 3 analytics rows, removed %', v_n; END IF;

  -- 3. Preservation assertions.
  PERFORM 1 FROM public.community_place_status_history
    WHERE id = '11da6d85-ce58-4cc1-81fa-281d11a8d8d0' AND action = 'reactivated';
  IF NOT FOUND THEN RAISE EXCEPTION 'WO-058B: BA XA reactivation history missing'; END IF;

  SELECT count(*) INTO v_n FROM public.community_places
    WHERE veggie_classification = 'fully_vegan' AND is_active AND maintenance_status = 'operational';
  IF v_n <> 3 THEN RAISE EXCEPTION 'WO-058B: expected 3 fully vegan active operational places, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.community_place_vegan_reviews;
  IF v_n <> 0 THEN RAISE EXCEPTION 'WO-058B: leftover vegan-review rows: %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.community_place_vegan_classification_history;
  IF v_n <> 0 THEN RAISE EXCEPTION 'WO-058B: leftover classification-history rows: %', v_n; END IF;

  -- 4. Insert temporary probe rows, then restore protections and prove they hold.
  INSERT INTO public.community_place_vegan_reviews (community_place_id, status, started_by, completed_by, completed_at, result)
  VALUES (v_place, 'completed', v_profile, v_profile, now(), 'confirmed_fully_vegan')
  RETURNING id INTO v_probe_review;

  INSERT INTO public.community_place_vegan_classification_history
    (community_place_id, old_classification, new_classification, action, changed_by)
  VALUES (v_place, 'fully_vegan', 'fully_vegan', 'vegan_status_confirmed', v_profile)
  RETURNING id INTO v_probe_class;

  ALTER TABLE public.community_place_vegan_reviews ENABLE TRIGGER community_place_vegan_reviews_immutable;
  ALTER TABLE public.community_place_vegan_classification_history ENABLE TRIGGER community_place_vegan_class_history_append_only;

  v_blocked := false;
  BEGIN
    UPDATE public.community_place_vegan_reviews SET owner_note = 'probe' WHERE id = v_probe_review;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'WO-058B: completed vegan review is still updatable'; END IF;

  v_blocked := false;
  BEGIN
    DELETE FROM public.community_place_vegan_reviews WHERE id = v_probe_review;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'WO-058B: completed vegan review is still deletable'; END IF;

  v_blocked := false;
  BEGIN
    UPDATE public.community_place_vegan_classification_history SET action = 'probe' WHERE id = v_probe_class;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'WO-058B: classification history is still updatable'; END IF;

  v_blocked := false;
  BEGIN
    DELETE FROM public.community_place_vegan_classification_history WHERE id = v_probe_class;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'WO-058B: classification history is still deletable'; END IF;

  -- 5. Remove the probe rows inside this same migration, then restore protections for good.
  ALTER TABLE public.community_place_vegan_reviews DISABLE TRIGGER community_place_vegan_reviews_immutable;
  ALTER TABLE public.community_place_vegan_classification_history DISABLE TRIGGER community_place_vegan_class_history_append_only;

  DELETE FROM public.community_place_vegan_reviews WHERE id = v_probe_review;
  DELETE FROM public.community_place_vegan_classification_history WHERE id = v_probe_class;

  ALTER TABLE public.community_place_vegan_reviews ENABLE TRIGGER community_place_vegan_reviews_immutable;
  ALTER TABLE public.community_place_vegan_classification_history ENABLE TRIGGER community_place_vegan_class_history_append_only;

  -- 6. Final state assertions.
  SELECT count(*) INTO v_n FROM public.community_place_vegan_reviews;
  IF v_n <> 0 THEN RAISE EXCEPTION 'WO-058B: vegan-review table not empty: %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.community_place_vegan_classification_history;
  IF v_n <> 0 THEN RAISE EXCEPTION 'WO-058B: classification-history table not empty: %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.community_place_status_history;
  IF v_n <> 1 THEN RAISE EXCEPTION 'WO-058B: expected only the BA XA status-history row, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_trigger
    WHERE tgname IN ('community_place_vegan_reviews_immutable','community_place_vegan_class_history_append_only')
      AND tgenabled = 'O';
  IF v_n <> 2 THEN RAISE EXCEPTION 'WO-058B: append-only triggers not fully re-enabled (% of 2)', v_n; END IF;
END $$;