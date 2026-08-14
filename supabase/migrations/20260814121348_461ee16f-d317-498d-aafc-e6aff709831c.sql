-- WO-106B: constraint-safe featured rank normalization.
-- The rank CHECK requires featured_rank >= 1 for featured rows and is IMMEDIATE,
-- so the previous "negative temporary rank" two-phase write raised 23514 on every
-- featured mutation. Use a high positive temporary band instead (offset 1000000),
-- which satisfies both the CHECK and the partial unique index at all times.

CREATE OR REPLACE FUNCTION public.normalize_today_featured_ranks(_city_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k_offset constant int := 1000000;
BEGIN
  -- Phase 1: park every featured row for this city in a collision-free
  -- high positive band that still satisfies featured_rank >= 1.
  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY featured_rank, updated_at, id) AS rn
    FROM public.today_place_curation
    WHERE city_id = _city_id AND state = 'featured'
  )
  UPDATE public.today_place_curation t
     SET featured_rank = k_offset + o.rn
    FROM ordered o
   WHERE t.id = o.id;

  -- Phase 2: bring them down to 1..n with no gaps.
  UPDATE public.today_place_curation t
     SET featured_rank = t.featured_rank - k_offset
   WHERE t.city_id = _city_id
     AND t.state = 'featured'
     AND t.featured_rank > k_offset;
END $function$;

CREATE OR REPLACE FUNCTION public.reorder_today_featured_places(_city_id uuid, _ordered_place_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  v_count int;
  v_expected int;
  k_offset constant int := 1000000;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _city_id IS NULL OR _ordered_place_ids IS NULL THEN
    RAISE EXCEPTION 'A city and an order are required';
  END IF;

  me := public.current_profile_id();
  PERFORM pg_advisory_xact_lock(hashtext('today_place_curation:' || _city_id::text));

  SELECT count(*) INTO v_expected
  FROM public.today_place_curation
  WHERE city_id = _city_id AND state = 'featured';

  SELECT count(*) INTO v_count
  FROM public.today_place_curation tc
  WHERE tc.city_id = _city_id AND tc.state = 'featured'
    AND tc.community_place_id = ANY(_ordered_place_ids);

  IF v_count <> v_expected OR v_count <> cardinality(_ordered_place_ids) THEN
    RAISE EXCEPTION 'That order no longer matches the featured places for this city';
  END IF;

  -- Two-phase write through a high positive temporary band: never violates
  -- the featured_rank >= 1 CHECK nor the (city_id, featured_rank) unique index.
  UPDATE public.today_place_curation t
     SET featured_rank = k_offset + o.rn, updated_by = me, updated_at = now()
    FROM (SELECT pid, row_number() OVER () AS rn
          FROM unnest(_ordered_place_ids) AS pid) o
   WHERE t.community_place_id = o.pid AND t.city_id = _city_id AND t.state = 'featured';

  UPDATE public.today_place_curation t
     SET featured_rank = t.featured_rank - k_offset
   WHERE t.city_id = _city_id AND t.state = 'featured' AND t.featured_rank > k_offset;

  RETURN jsonb_build_object('city_id', _city_id::text, 'featured_count', v_count);
END $function$;

REVOKE ALL ON FUNCTION public.normalize_today_featured_ranks(uuid) FROM PUBLIC;
