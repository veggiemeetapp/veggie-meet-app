-- 1) Remove member/visitor readable coordinates from community_places.
REVOKE ALL (latitude, longitude) ON public.community_places FROM anon;
REVOKE ALL (latitude, longitude) ON public.community_places FROM authenticated;
REVOKE ALL (latitude, longitude) ON public.community_places FROM PUBLIC;

-- 2) Server-side discovery: returns member-safe place fields plus a
--    coarse distance computed inside a SECURITY DEFINER boundary.
CREATE OR REPLACE FUNCTION public.get_community_places_discovery(
  _city_id uuid DEFAULT NULL,
  _include_all_cities boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid;
  ref_lat double precision;
  ref_lng double precision;
  items jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF _city_id IS NOT NULL THEN
    SELECT c.latitude, c.longitude INTO ref_lat, ref_lng
      FROM public.cities c WHERE c.id = _city_id;
  END IF;

  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.sort_distance NULLS LAST, q.same_city, q.neighborhood, q.name), '[]'::jsonb)
    INTO items
  FROM (
    SELECT
      p.name,
      COALESCE(p.neighborhood, '') AS neighborhood,
      CASE WHEN _city_id IS NOT NULL AND p.city_id = _city_id THEN 0 ELSE 1 END AS same_city,
      d.dist AS sort_distance,
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category::text,
        'address', p.address,
        'neighborhood', p.neighborhood,
        'city_id', p.city_id,
        'city_name', c.name,
        'timezone', p.timezone,
        'cover_image_url', CASE WHEN p.image_rights_status = 'cleared' THEN p.cover_image_url ELSE NULL END,
        'has_cover_image', p.image_rights_status = 'cleared' AND p.cover_image_url IS NOT NULL,
        'description', p.description,
        'veggie_reason', p.veggie_reason,
        'website_url', p.website_url,
        'google_maps_url', p.google_maps_url,
        'veggie_classification', p.veggie_classification,
        'maintenance_status', COALESCE(p.maintenance_status, 'operational'),
        'is_active', p.is_active,
        'upcoming_meetups_count', p.upcoming_meetups_count,
        'meetups_this_month', p.meetups_this_month,
        'veggies_visited_count', p.veggies_visited_count,
        'last_reverified_at', p.last_reverified_at,
        -- Coarse distance only (nearest 50 m); never exact coordinates.
        'distance_meters', CASE WHEN d.dist IS NULL THEN NULL ELSE (round(d.dist / 50.0) * 50)::int END
      ) AS item
    FROM public.community_places p
    LEFT JOIN public.cities c ON c.id = p.city_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN ref_lat IS NULL OR ref_lng IS NULL OR p.latitude IS NULL OR p.longitude IS NULL THEN NULL
        ELSE 2 * 6371000 * asin(sqrt(
               power(sin(radians(p.latitude - ref_lat) / 2), 2)
               + cos(radians(ref_lat)) * cos(radians(p.latitude))
               * power(sin(radians(p.longitude - ref_lng) / 2), 2)))
      END AS dist
    ) d
    WHERE p.is_active IS TRUE
      AND p.verification_status = 'verified'
      AND COALESCE(p.maintenance_status, 'operational') = 'operational'
      AND (p.business_status IS NULL OR p.business_status = 'OPERATIONAL')
      AND (_include_all_cities OR _city_id IS NULL OR p.city_id = _city_id)
  ) q;

  RETURN items;
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_places_discovery(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_community_places_discovery(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_community_places_discovery(uuid, boolean) TO authenticated;

-- 3) Search must not emit exact coordinates either.
CREATE OR REPLACE FUNCTION public.search_community_places(_query text, _city_id uuid DEFAULT NULL::uuid, _include_all_cities boolean DEFAULT false, _categories text[] DEFAULT NULL::text[], _neighborhood text DEFAULT NULL::text, _limit integer DEFAULT 20, _cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _me uuid;
  _q text := public.search_norm(_query);
  _limit_clamped int := LEAST(GREATEST(coalesce(_limit, 20), 1), 20);
  _cur_score numeric;
  _cur_id uuid;
  _items jsonb;
  _next text;
BEGIN
  SELECT p.id INTO _me FROM public.profiles p WHERE p.auth_user_id = auth.uid();
  IF _me IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  IF _cursor IS NOT NULL AND position(':' IN _cursor) > 0 THEN
    _cur_score := split_part(_cursor, ':', 1)::numeric;
    _cur_id := split_part(_cursor, ':', 2)::uuid;
  END IF;

  WITH base AS (
    SELECT
      pl.*,
      c.name AS city_name
    FROM public.community_places pl
    LEFT JOIN public.cities c ON c.id = pl.city_id
    WHERE pl.is_active IS TRUE AND pl.verification_status = 'verified' AND COALESCE(pl.maintenance_status, 'operational') = 'operational'
      AND (_include_all_cities OR _city_id IS NULL OR pl.city_id = _city_id)
      AND (_categories IS NULL OR array_length(_categories,1) IS NULL OR pl.category::text = ANY(_categories))
      AND (_neighborhood IS NULL OR public.search_norm(pl.neighborhood) = public.search_norm(_neighborhood))
      AND (
        _q = '' OR
        public.search_norm(pl.name) LIKE '%'||_q||'%'
        OR public.search_norm(pl.category::text) LIKE '%'||_q||'%'
        OR public.search_norm(pl.address) LIKE '%'||_q||'%'
        OR public.search_norm(pl.neighborhood) LIKE '%'||_q||'%'
      )
  ),
  scored AS (
    SELECT
      b.*,
      (
        CASE WHEN _q <> '' AND public.search_norm(b.name) = _q THEN 1000
             WHEN _q <> '' AND public.search_norm(b.name) LIKE _q||'%' THEN 700
             ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(b.category::text) = _q THEN 300 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(b.neighborhood) LIKE '%'||_q||'%' THEN 100 ELSE 0 END
        + CASE WHEN _q <> '' AND public.search_norm(b.address) LIKE '%'||_q||'%' THEN 40 ELSE 0 END
      )::numeric AS score
    FROM base b
  ),
  paged AS (
    SELECT * FROM scored
    WHERE (_cur_score IS NULL OR (score, id) < (_cur_score, _cur_id))
    ORDER BY score DESC, id ASC
    LIMIT _limit_clamped
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'entity_type', 'place',
      'entity_id', p.id,
      'name', p.name,
      'category', p.category,
      'address', p.address,
      'cover_image_url', p.cover_image_url,
      'city_id', p.city_id,
      'city_name', p.city_name,
      'neighborhood', p.neighborhood,
      'upcoming_meetups_count', p.upcoming_meetups_count,
      'reason_code',
        CASE
          WHEN _q <> '' AND public.search_norm(p.category::text) = _q THEN 'category_match'
          WHEN p.neighborhood IS NOT NULL THEN 'neighborhood'
          WHEN p.city_name IS NOT NULL THEN 'city'
          ELSE 'match'
        END,
      'reason_label',
        CASE
          WHEN p.neighborhood IS NOT NULL THEN 'In '||p.neighborhood
          WHEN p.city_name IS NOT NULL THEN 'In '||p.city_name
          ELSE NULL
        END,
      'cursor', p.score::text || ':' || p.id::text,
      'score', p.score
    ) ORDER BY p.score DESC, p.id ASC
  )
  INTO _items
  FROM paged p;

  _items := COALESCE(_items, '[]'::jsonb);
  IF jsonb_array_length(_items) = _limit_clamped THEN
    _next := (_items->-1->>'cursor');
  END IF;
  RETURN jsonb_build_object('items', _items, 'next_cursor', _next);
END $function$;