CREATE OR REPLACE FUNCTION public.update_community_place_details(
  _place_id uuid,
  _name text,
  _address text,
  _neighborhood text,
  _category text,
  _website_url text DEFAULT NULL,
  _google_maps_url text DEFAULT NULL,
  _latitude double precision DEFAULT NULL,
  _longitude double precision DEFAULT NULL,
  _description text DEFAULT NULL,
  _source text DEFAULT 'owner_review',
  _internal_note text DEFAULT NULL,
  _official_source_url text DEFAULT NULL,
  _source_reference_id uuid DEFAULT NULL,
  _acknowledge_identity_risk boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p community_places;
  v_owner uuid;
  v_name text; v_addr text; v_hood text; v_cat text;
  v_site text; v_maps text; v_desc text;
  v_note text; v_src_ref uuid; v_evidence text;
  changed text[] := '{}'::text[];
  before_j jsonb := '{}'::jsonb;
  after_j jsonb := '{}'::jsonb;
  v_dist double precision;
  v_name_overlap double precision;
  v_addr_overlap double precision;
  risks text[] := '{}'::text[];
  hard_block boolean := false;
BEGIN
  IF NOT public.is_owner() THEN RETURN json_build_object('ok', false, 'reason', 'owner_only'); END IF;

  SELECT * INTO p FROM community_places WHERE id = _place_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'place_not_found'); END IF;
  IF p.verification_status <> 'verified' THEN
    RETURN json_build_object('ok', false, 'reason', 'place_not_published');
  END IF;

  IF _source NOT IN ('reverification','member_report','owner_review','google_check','manual_correction') THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_source');
  END IF;
  v_note := btrim(coalesce(_internal_note, ''));
  IF char_length(v_note) = 0 OR char_length(v_note) > 500 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_note');
  END IF;

  v_evidence := nullif(btrim(coalesce(_official_source_url, '')), '');
  IF v_evidence IS NOT NULL AND NOT public._detail_url_ok(v_evidence) THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_official_source_url');
  END IF;

  v_src_ref := NULL;
  IF _source_reference_id IS NOT NULL THEN
    IF _source = 'reverification' THEN
      SELECT id INTO v_src_ref FROM community_place_reverifications
      WHERE id = _source_reference_id AND community_place_id = _place_id;
    ELSIF _source = 'member_report' THEN
      SELECT id INTO v_src_ref FROM community_place_reports
      WHERE id = _source_reference_id AND community_place_id = _place_id;
    END IF;
    IF v_src_ref IS NULL THEN
      RETURN json_build_object('ok', false, 'reason', 'invalid_source_reference');
    END IF;
  END IF;

  v_name := btrim(coalesce(_name, ''));
  IF char_length(v_name) < 2 OR char_length(v_name) > 160
     OR public._detail_norm(v_name) = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_name');
  END IF;

  v_addr := btrim(coalesce(_address, ''));
  IF char_length(v_addr) < 5 OR char_length(v_addr) > 300
     OR public._detail_norm(v_addr) = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_address');
  END IF;

  v_hood := nullif(btrim(coalesce(_neighborhood, '')), '');
  IF p.neighborhood IS NOT NULL AND v_hood IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_area');
  END IF;
  IF v_hood IS NOT NULL AND char_length(v_hood) > 120 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_area');
  END IF;

  v_cat := btrim(coalesce(_category, ''));
  IF v_cat NOT IN ('restaurant','cafe','park','market','studio','venue') THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_category');
  END IF;

  v_site := nullif(btrim(coalesce(_website_url, '')), '');
  IF v_site IS NOT NULL AND NOT public._detail_url_ok(v_site) THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_website');
  END IF;

  v_maps := nullif(btrim(coalesce(_google_maps_url, '')), '');
  IF v_maps IS NOT NULL AND (
       NOT public._detail_url_ok(v_maps)
       OR v_maps !~* '^https://([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)/'
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_google_maps_url');
  END IF;

  IF (_latitude IS NULL) <> (_longitude IS NULL) THEN
    RETURN json_build_object('ok', false, 'reason', 'coordinates_incomplete');
  END IF;
  IF _latitude IS NOT NULL THEN
    IF _latitude <> _latitude OR _longitude <> _longitude
       OR _latitude IN ('Infinity'::double precision, '-Infinity'::double precision)
       OR _longitude IN ('Infinity'::double precision, '-Infinity'::double precision)
       OR _latitude < -90 OR _latitude > 90
       OR _longitude < -180 OR _longitude > 180 THEN
      RETURN json_build_object('ok', false, 'reason', 'invalid_coordinates');
    END IF;
  END IF;
  IF p.latitude IS NOT NULL AND _latitude IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'coordinates_required');
  END IF;

  v_desc := nullif(btrim(coalesce(_description, '')), '');
  IF v_desc IS NOT NULL AND char_length(v_desc) > 1000 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_description');
  END IF;

  -- server-derived changed set (client "before" is never trusted)
  IF v_name IS DISTINCT FROM p.name THEN
    changed := array_append(changed, 'name');
    before_j := before_j || jsonb_build_object('name', p.name);
    after_j  := after_j  || jsonb_build_object('name', v_name);
  END IF;
  IF v_addr IS DISTINCT FROM p.address THEN
    changed := array_append(changed, 'address');
    before_j := before_j || jsonb_build_object('address', p.address);
    after_j  := after_j  || jsonb_build_object('address', v_addr);
  END IF;
  IF v_hood IS DISTINCT FROM p.neighborhood THEN
    changed := array_append(changed, 'neighborhood');
    before_j := before_j || jsonb_build_object('neighborhood', p.neighborhood);
    after_j  := after_j  || jsonb_build_object('neighborhood', v_hood);
  END IF;
  IF v_cat IS DISTINCT FROM p.category::text THEN
    changed := array_append(changed, 'category');
    before_j := before_j || jsonb_build_object('category', p.category::text);
    after_j  := after_j  || jsonb_build_object('category', v_cat);
  END IF;
  IF v_site IS DISTINCT FROM p.website_url THEN
    changed := array_append(changed, 'website_url');
    before_j := before_j || jsonb_build_object('website_url', p.website_url);
    after_j  := after_j  || jsonb_build_object('website_url', v_site);
  END IF;
  IF v_maps IS DISTINCT FROM p.google_maps_url THEN
    changed := array_append(changed, 'google_maps_url');
    before_j := before_j || jsonb_build_object('google_maps_url', p.google_maps_url);
    after_j  := after_j  || jsonb_build_object('google_maps_url', v_maps);
  END IF;
  IF _latitude IS DISTINCT FROM p.latitude OR _longitude IS DISTINCT FROM p.longitude THEN
    changed := array_append(changed, 'coordinates');
    before_j := before_j || jsonb_build_object('latitude', p.latitude, 'longitude', p.longitude);
    after_j  := after_j  || jsonb_build_object('latitude', _latitude, 'longitude', _longitude);
  END IF;
  IF v_desc IS DISTINCT FROM p.description THEN
    changed := array_append(changed, 'description');
    before_j := before_j || jsonb_build_object('description', p.description);
    after_j  := after_j  || jsonb_build_object('description', v_desc);
  END IF;

  IF array_length(changed, 1) IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_changes');
  END IF;

  -- identity safety (documented heuristic, not proof of identity)
  IF 'coordinates' = ANY(changed) THEN
    v_dist := public._detail_distance_m(p.latitude, p.longitude, _latitude, _longitude);
    IF v_dist IS NOT NULL AND v_dist > 1000 THEN
      risks := array_append(risks, 'coordinates_moved_far'); hard_block := true;
    ELSIF v_dist IS NOT NULL AND v_dist > 250 THEN
      risks := array_append(risks, 'coordinates_moved');
    END IF;
  END IF;
  IF 'name' = ANY(changed) THEN
    v_name_overlap := public._detail_token_overlap(p.name, v_name);
    IF v_name_overlap < 0.34
       AND position(public._detail_norm(v_name) in public._detail_norm(p.name)) = 0
       AND position(public._detail_norm(p.name) in public._detail_norm(v_name)) = 0 THEN
      risks := array_append(risks, 'name_changed_substantially'); hard_block := true;
    ELSIF v_name_overlap < 0.7 THEN
      risks := array_append(risks, 'name_changed');
    END IF;
  END IF;
  IF 'address' = ANY(changed) THEN
    v_addr_overlap := public._detail_token_overlap(p.address, v_addr);
    IF v_addr_overlap < 0.34 THEN
      risks := array_append(risks, 'address_changed_substantially'); hard_block := true;
    ELSIF v_addr_overlap < 0.7 THEN
      risks := array_append(risks, 'address_changed');
    END IF;
  END IF;
  IF 'category' = ANY(changed) AND p.category::text IN ('restaurant','cafe','market')
     AND v_cat IN ('park','studio','venue') THEN
    risks := array_append(risks, 'category_inconsistent');
  END IF;

  IF hard_block THEN
    RETURN json_build_object('ok', false, 'reason', 'identity_change_blocked',
      'risks', to_json(risks), 'distance_m', v_dist);
  END IF;
  IF array_length(risks, 1) IS NOT NULL AND _acknowledge_identity_risk IS NOT TRUE THEN
    RETURN json_build_object('ok', false, 'reason', 'identity_risk_unacknowledged',
      'risks', to_json(risks), 'distance_m', v_dist);
  END IF;

  SELECT id INTO v_owner FROM profiles WHERE auth_user_id = auth.uid();

  UPDATE community_places SET
    name = v_name,
    address = v_addr,
    neighborhood = v_hood,
    category = v_cat::place_category,
    website_url = v_site,
    google_maps_url = v_maps,
    latitude = _latitude,
    longitude = _longitude,
    description = v_desc
  WHERE id = _place_id;

  INSERT INTO community_place_detail_changes (
    community_place_id, changed_by, source, source_reference_id, official_source_url,
    reason, internal_note, before_data, after_data, changed_fields)
  VALUES (_place_id, v_owner, _source, v_src_ref, v_evidence,
          _source, v_note, before_j, after_j, changed);

  RETURN json_build_object(
    'ok', true,
    'changed_fields', to_json(changed),
    'risks', to_json(risks),
    'distance_m', v_dist,
    'place', (SELECT to_json(t) FROM (
       SELECT id, name, address, neighborhood, category::text AS category, website_url,
              google_maps_url, latitude, longitude, description, is_active,
              maintenance_status, verification_status, veggie_classification,
              verified_at, last_reverified_at, updated_at
       FROM community_places WHERE id = _place_id) t)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.update_community_place_details(uuid,text,text,text,text,text,text,double precision,double precision,text,text,text,text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_community_place_details(uuid,text,text,text,text,text,text,double precision,double precision,text,text,text,text,uuid,boolean) TO authenticated, service_role;