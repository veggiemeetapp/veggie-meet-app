-- ============================================================
-- WO-106 — Today Community Place curation (owner editorial layer)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.today_place_curation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'normal',
  featured_rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT today_place_curation_state_chk CHECK (state IN ('normal','featured','hidden')),
  CONSTRAINT today_place_curation_rank_chk CHECK (
    (state = 'featured' AND featured_rank IS NOT NULL AND featured_rank >= 1)
    OR (state <> 'featured' AND featured_rank IS NULL)
  ),
  CONSTRAINT today_place_curation_place_uniq UNIQUE (community_place_id)
);

-- No anon/authenticated grants: every read and write goes through the
-- owner-only SECURITY DEFINER RPCs below, and the Today RPC reads it
-- internally. Editorial state is never exposed to members.
GRANT ALL ON public.today_place_curation TO service_role;

ALTER TABLE public.today_place_curation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages Today curation" ON public.today_place_curation;
CREATE POLICY "Owner manages Today curation"
  ON public.today_place_curation
  FOR ALL
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- No duplicate featured position within a city.
CREATE UNIQUE INDEX IF NOT EXISTS today_place_curation_city_rank_uniq
  ON public.today_place_curation (city_id, featured_rank)
  WHERE state = 'featured';

-- Today lookup path: cheap join by place, and city/state/rank listing.
CREATE INDEX IF NOT EXISTS today_place_curation_city_state_rank_idx
  ON public.today_place_curation (city_id, state, featured_rank);

DROP TRIGGER IF EXISTS trg_today_place_curation_updated_at ON public.today_place_curation;
CREATE TRIGGER trg_today_place_curation_updated_at
  BEFORE UPDATE ON public.today_place_curation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Internal helper: normalize featured ranks to 1..n for a city.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_today_featured_ranks(_city_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY featured_rank, updated_at, id) AS rn
    FROM public.today_place_curation
    WHERE city_id = _city_id AND state = 'featured'
  )
  UPDATE public.today_place_curation t
     SET featured_rank = -o.rn
    FROM ordered o
   WHERE t.id = o.id AND t.featured_rank <> -o.rn;

  UPDATE public.today_place_curation t
     SET featured_rank = -t.featured_rank
   WHERE t.city_id = _city_id AND t.state = 'featured' AND t.featured_rank < 0;
END $fn$;

REVOKE ALL ON FUNCTION public.normalize_today_featured_ranks(uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- Owner read: curation workspace for one city.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_today_place_curation(_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'city_id', _city_id,
    'slot_limit', 3,
    'places', COALESCE(jsonb_agg(row_json ORDER BY feat_first, feat_rank, name), '[]'::jsonb)
  ) INTO result
  FROM (
    SELECT
      cp.name,
      CASE WHEN COALESCE(tc.state,'normal') = 'featured' THEN 0 ELSE 1 END AS feat_first,
      COALESCE(tc.featured_rank, 2147483647) AS feat_rank,
      jsonb_build_object(
        'place_id', cp.id::text,
        'name', cp.name,
        'category', cp.category,
        'is_active', cp.is_active,
        'maintenance_status', cp.maintenance_status,
        'verification_status', cp.verification_status,
        'state', COALESCE(tc.state,'normal'),
        'featured_rank', tc.featured_rank
      ) AS row_json
    FROM public.community_places cp
    LEFT JOIN public.today_place_curation tc ON tc.community_place_id = cp.id
    WHERE cp.city_id = _city_id
  ) t;

  RETURN COALESCE(result, jsonb_build_object('city_id', _city_id, 'slot_limit', 3, 'places', '[]'::jsonb));
END $fn$;

REVOKE ALL ON FUNCTION public.get_today_place_curation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_today_place_curation(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Owner write: set one place's Today state.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_today_place_state(_place_id uuid, _state text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  me uuid;
  v_city uuid;
  v_name text;
  v_featured int;
  v_rank int;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _state NOT IN ('normal','featured','hidden') THEN
    RAISE EXCEPTION 'Unsupported Today state';
  END IF;

  SELECT city_id, name INTO v_city, v_name
  FROM public.community_places WHERE id = _place_id;

  IF v_city IS NULL THEN
    RAISE EXCEPTION 'This Community Place is not linked to a city yet';
  END IF;

  me := public.current_profile_id();

  -- Serialize concurrent curation edits per city so ranks stay deterministic.
  PERFORM pg_advisory_xact_lock(hashtext('today_place_curation:' || v_city::text));

  IF _state = 'featured' THEN
    SELECT count(*) INTO v_featured
    FROM public.today_place_curation
    WHERE city_id = v_city AND state = 'featured' AND community_place_id <> _place_id;

    IF v_featured >= 3 THEN
      RAISE EXCEPTION 'Today shows up to 3 Community Places. Remove one featured place first.';
    END IF;

    v_rank := v_featured + 1;

    INSERT INTO public.today_place_curation (city_id, community_place_id, state, featured_rank, updated_by)
    VALUES (v_city, _place_id, 'featured', v_rank, me)
    ON CONFLICT (community_place_id) DO UPDATE
      SET city_id = v_city,
          state = 'featured',
          featured_rank = CASE WHEN public.today_place_curation.state = 'featured'
                               THEN public.today_place_curation.featured_rank
                               ELSE v_rank END,
          updated_by = me,
          updated_at = now();
  ELSE
    INSERT INTO public.today_place_curation (city_id, community_place_id, state, featured_rank, updated_by)
    VALUES (v_city, _place_id, _state, NULL, me)
    ON CONFLICT (community_place_id) DO UPDATE
      SET city_id = v_city,
          state = _state,
          featured_rank = NULL,
          updated_by = me,
          updated_at = now();
  END IF;

  PERFORM public.normalize_today_featured_ranks(v_city);

  SELECT featured_rank INTO v_rank
  FROM public.today_place_curation WHERE community_place_id = _place_id;

  RETURN jsonb_build_object(
    'place_id', _place_id::text,
    'city_id', v_city::text,
    'state', _state,
    'featured_rank', v_rank
  );
END $fn$;

REVOKE ALL ON FUNCTION public.set_today_place_state(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_today_place_state(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- Owner write: explicit featured order for a city.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_today_featured_places(_city_id uuid, _ordered_place_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  me uuid;
  v_count int;
  v_expected int;
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

  -- Two-phase write (negative first) keeps the unique index satisfied.
  UPDATE public.today_place_curation t
     SET featured_rank = -o.rn, updated_by = me, updated_at = now()
    FROM (SELECT pid, row_number() OVER () AS rn
          FROM unnest(_ordered_place_ids) AS pid) o
   WHERE t.community_place_id = o.pid AND t.city_id = _city_id AND t.state = 'featured';

  UPDATE public.today_place_curation t
     SET featured_rank = -t.featured_rank
   WHERE t.city_id = _city_id AND t.state = 'featured' AND t.featured_rank < 0;

  RETURN jsonb_build_object('city_id', _city_id::text, 'featured_count', v_count);
END $fn$;

REVOKE ALL ON FUNCTION public.reorder_today_featured_places(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_today_featured_places(uuid, uuid[]) TO authenticated;

-- ------------------------------------------------------------
-- Today integration: featured-first, then the EXISTING automatic
-- ranking, applied server-side via targeted surgery on the live
-- get_my_today_experience() body so nothing else changes.
-- ------------------------------------------------------------
DO $mig$
DECLARE
  src text;
  out_src text;
  old_a text;
  new_a text;
  old_b text;
  new_b text;
  old_c text;
  new_c text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_my_today_experience';

  IF src IS NULL THEN
    RAISE EXCEPTION 'get_my_today_experience() not found';
  END IF;

  old_a := '      (cp.id::text IN (SELECT place_id FROM supported)) AS supported_by_me
    FROM community_places cp
    WHERE cp.is_active
      AND (my_city_id IS NULL OR cp.city_id IS NULL OR cp.city_id = my_city_id)
      AND cp.id::text NOT IN (SELECT entity_id FROM hidden)
  ),';

  new_a := '      (cp.id::text IN (SELECT place_id FROM supported)) AS supported_by_me,
      COALESCE(tc.state, ''normal'') AS today_state,
      tc.featured_rank AS today_featured_rank
    FROM community_places cp
    LEFT JOIN today_place_curation tc ON tc.community_place_id = cp.id
    WHERE cp.is_active
      AND (my_city_id IS NULL OR cp.city_id IS NULL OR cp.city_id = my_city_id)
      AND cp.id::text NOT IN (SELECT entity_id FROM hidden)
      AND COALESCE(tc.state, ''normal'') <> ''hidden''
  ),';

  old_b := '    FROM candidates c
    WHERE (NOT c.supported_by_me) OR c.has_upcoming
  )';

  new_b := '    FROM candidates c
    WHERE c.today_state = ''featured'' OR (NOT c.supported_by_me) OR c.has_upcoming
  )';

  old_c := '    FROM ranked r
    ORDER BY score DESC, id LIMIT 3
  ) t;';

  new_c := '    FROM ranked r
    ORDER BY (CASE WHEN r.today_state = ''featured'' THEN 0 ELSE 1 END),
             COALESCE(r.today_featured_rank, 2147483647),
             r.score DESC, r.id
    LIMIT 3
  ) t;';

  IF position(old_a in src) = 0 OR position(old_b in src) = 0 OR position(old_c in src) = 0 THEN
    RAISE EXCEPTION 'Today place-recommendation block did not match the expected shape';
  END IF;

  out_src := replace(src, old_a, new_a);
  out_src := replace(out_src, old_b, new_b);
  out_src := replace(out_src, old_c, new_c);

  -- Featured-first must also drive the aggregate order, not just the subquery.
  out_src := replace(
    out_src,
    'SELECT COALESCE(jsonb_agg(row_json ORDER BY score DESC, id), ''[]''::jsonb) INTO place_recs
  FROM (
    SELECT r.id, r.score,',
    'SELECT COALESCE(jsonb_agg(row_json ORDER BY feat_first, feat_rank, score DESC, id), ''[]''::jsonb) INTO place_recs
  FROM (
    SELECT r.id, r.score,
      (CASE WHEN r.today_state = ''featured'' THEN 0 ELSE 1 END) AS feat_first,
      COALESCE(r.today_featured_rank, 2147483647) AS feat_rank,');

  IF position('feat_first' in out_src) = 0 THEN
    RAISE EXCEPTION 'Today place aggregate order did not match the expected shape';
  END IF;

  EXECUTE out_src;
END $mig$;
