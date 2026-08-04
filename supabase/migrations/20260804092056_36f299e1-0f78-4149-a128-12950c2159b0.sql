-- WO-057 — Safely update published Community Place public details (owner-only).

CREATE TABLE public.community_place_detail_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  source_reference_id uuid,
  official_source_url text,
  reason text,
  internal_note text NOT NULL,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cpdc_source_chk CHECK (source IN ('reverification','member_report','owner_review','google_check','manual_correction')),
  CONSTRAINT cpdc_note_chk CHECK (char_length(internal_note) BETWEEN 1 AND 500),
  CONSTRAINT cpdc_changed_fields_chk CHECK (array_length(changed_fields, 1) >= 1)
);

CREATE INDEX cpdc_place_idx ON public.community_place_detail_changes (community_place_id, changed_at DESC);

-- Private audit: no anon access at all, and no direct client writes. Reads go
-- through owner-only SECURITY DEFINER RPCs, so `authenticated` needs nothing.
REVOKE ALL ON public.community_place_detail_changes FROM anon, authenticated;
GRANT ALL ON public.community_place_detail_changes TO service_role;
ALTER TABLE public.community_place_detail_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads place detail changes"
  ON public.community_place_detail_changes FOR SELECT TO authenticated
  USING (public.is_owner());

-- ---------------------------------------------------------------------------
-- Identity-safety helpers
-- ---------------------------------------------------------------------------

-- No unaccent extension dependency: fold the Vietnamese/Latin ranges we need.
CREATE OR REPLACE FUNCTION public.unaccent_fallback(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(
    coalesce(_t, ''),
    'àáâãäåăạảấầẩẫậắằẳẵặèéêëẹẻẽếềểễệìíîïỉịòóôõöơọỏốồổỗộớờởỡợùúûüưụủứừửữựỳýỵỷỹñçđÀÁÂÃÄÅĂẠẢẤẦẨẪẬẮẰẲẴẶÈÉÊËẸẺẼẾỀỂỄỆÌÍÎÏỈỊÒÓÔÕÖƠỌỎỐỒỔỖỘỚỜỞỠỢÙÚÛÜƯỤỦỨỪỬỮỰỲÝỴỶỸÑÇĐ',
    'aaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeiiiiiioooooooooooooooooooouuuuuuuuuuuuuyyyyyncdAAAAAAAAAAAAAAAAAAAAAEEEEEEEEEEEEIIIIIIOOOOOOOOOOOOOOOOOOOOUUUUUUUUUUUUUYYYYYNCD')
$$;

-- Lowercase, strip diacritics and punctuation, collapse whitespace.
CREATE OR REPLACE FUNCTION public._detail_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(lower(coalesce(public.unaccent_fallback(_t), '')), '[^a-z0-9 ]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- Token overlap ratio (0..1) against the shorter token set.
CREATE OR REPLACE FUNCTION public._detail_token_overlap(_a text, _b text)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  a text[]; b text[]; shared int; smaller int;
BEGIN
  a := string_to_array(public._detail_norm(_a), ' ');
  b := string_to_array(public._detail_norm(_b), ' ');
  IF a IS NULL OR b IS NULL OR array_length(a,1) IS NULL OR array_length(b,1) IS NULL THEN
    RETURN 0;
  END IF;
  SELECT count(DISTINCT x) INTO shared FROM unnest(a) x WHERE x = ANY(b);
  smaller := least(cardinality(ARRAY(SELECT DISTINCT unnest(a))), cardinality(ARRAY(SELECT DISTINCT unnest(b))));
  IF smaller = 0 THEN RETURN 0; END IF;
  RETURN shared::double precision / smaller::double precision;
END;
$$;

-- Metres between two coordinate pairs (haversine).
CREATE OR REPLACE FUNCTION public._detail_distance_m(
  _lat1 double precision, _lon1 double precision,
  _lat2 double precision, _lon2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _lat1 IS NULL OR _lon1 IS NULL OR _lat2 IS NULL OR _lon2 IS NULL THEN NULL
    ELSE 2 * 6371000 * asin(sqrt(
      pow(sin(radians(_lat2 - _lat1) / 2), 2) +
      cos(radians(_lat1)) * cos(radians(_lat2)) * pow(sin(radians(_lon2 - _lon1) / 2), 2)))
  END
$$;

-- Public http(s) URL with no credentials and no scriptable scheme.
CREATE OR REPLACE FUNCTION public._detail_url_ok(_u text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _u ~* '^https?://[a-z0-9]([a-z0-9._-]*[a-z0-9])?(:[0-9]{1,5})?(/[^\s]*)?$'
     AND position('@' in _u) = 0
     AND char_length(_u) <= 500
$$;

-- ---------------------------------------------------------------------------
-- Owner-only edit workspace read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_community_place_edit_workspace(_place_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_place json; v_reports json; v_reverif json; v_history json;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'permission denied'; END IF;

  SELECT to_json(t) INTO v_place FROM (
    SELECT p.id, p.name, p.address, p.neighborhood, p.category::text AS category,
           p.website_url, p.google_maps_url, p.latitude, p.longitude, p.description,
           p.is_active, p.maintenance_status, p.verification_status,
           p.veggie_classification, p.business_status,
           (p.google_place_id IS NOT NULL) AS has_google_place_id,
           p.verified_at, p.last_reverified_at, p.updated_at,
           c.name AS city_name
    FROM community_places p LEFT JOIN cities c ON c.id = p.city_id
    WHERE p.id = _place_id
  ) t;

  IF v_place IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'place_not_found'); END IF;

  SELECT coalesce(json_agg(to_json(r) ORDER BY r.created_at DESC), '[]'::json) INTO v_reports FROM (
    SELECT id, reason_code, explanation, official_source_url, status, created_at
    FROM community_place_reports
    WHERE community_place_id = _place_id AND status IN ('pending','under_review')
  ) r;

  SELECT coalesce(json_agg(to_json(v) ORDER BY v.completed_at DESC NULLS FIRST), '[]'::json) INTO v_reverif FROM (
    SELECT id, status, result, started_at, completed_at
    FROM community_place_reverifications
    WHERE community_place_id = _place_id
    ORDER BY started_at DESC LIMIT 5
  ) v;

  SELECT coalesce(json_agg(to_json(h) ORDER BY h.changed_at DESC), '[]'::json) INTO v_history FROM (
    SELECT id, changed_at, source, source_reference_id, official_source_url,
           internal_note, changed_fields, before_data, after_data
    FROM community_place_detail_changes
    WHERE community_place_id = _place_id
    ORDER BY changed_at DESC LIMIT 20
  ) h;

  RETURN json_build_object('ok', true, 'place', v_place, 'open_reports', v_reports,
                           'reverifications', v_reverif, 'history', v_history);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_community_place_detail_changes(_place_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v json;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT coalesce(json_agg(to_json(h) ORDER BY h.changed_at DESC), '[]'::json) INTO v FROM (
    SELECT id, changed_at, source, source_reference_id, official_source_url,
           internal_note, changed_fields, before_data, after_data
    FROM community_place_detail_changes WHERE community_place_id = _place_id
  ) h;
  RETURN json_build_object('entries', v);
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner-only server-authoritative detail update
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_community_place_details(
  _place_id uuid,
  _name text,
  _address text,
  _neighborhood text,
  _category text,
  _website_url text,
  _google_maps_url text,
  _latitude double precision,
  _longitude double precision,
  _description text,
  _source text,
  _internal_note text,
  _official_source_url text DEFAULT NULL,
  _source_reference_id uuid DEFAULT NULL,
  _acknowledge_identity_risk boolean DEFAULT false
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p community_places;
  v_owner uuid;
  v_name text; v_addr text; v_hood text; v_cat text;
  v_site text; v_maps text; v_desc text;
  v_note text; v_src_ref uuid; v_evidence text;
  changed text[] := '{}';
  before_j jsonb := '{}'::jsonb;
  after_j jsonb := '{}'::jsonb;
  v_dist double precision;
  v_name_overlap double precision;
  v_addr_overlap double precision;
  risks text[] := '{}';
  hard_block boolean := false;
BEGIN
  IF NOT public.is_owner() THEN RETURN json_build_object('ok', false, 'reason', 'owner_only'); END IF;

  SELECT * INTO p FROM community_places WHERE id = _place_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'place_not_found'); END IF;
  IF p.verification_status <> 'verified' THEN
    RETURN json_build_object('ok', false, 'reason', 'place_not_published');
  END IF;

  -- ---- source + private note ----
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

  -- Source reference must belong to THIS place, or it is dropped.
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

  -- ---- field validation ----
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
    IF _latitude <> _latitude OR _longitude <> _longitude          -- NaN
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

  -- ---- server-derived changed set (client "before" is never trusted) ----
  IF v_name IS DISTINCT FROM p.name THEN
    changed := changed || 'name';
    before_j := before_j || jsonb_build_object('name', p.name);
    after_j  := after_j  || jsonb_build_object('name', v_name);
  END IF;
  IF v_addr IS DISTINCT FROM p.address THEN
    changed := changed || 'address';
    before_j := before_j || jsonb_build_object('address', p.address);
    after_j  := after_j  || jsonb_build_object('address', v_addr);
  END IF;
  IF v_hood IS DISTINCT FROM p.neighborhood THEN
    changed := changed || 'neighborhood';
    before_j := before_j || jsonb_build_object('neighborhood', p.neighborhood);
    after_j  := after_j  || jsonb_build_object('neighborhood', v_hood);
  END IF;
  IF v_cat IS DISTINCT FROM p.category::text THEN
    changed := changed || 'category';
    before_j := before_j || jsonb_build_object('category', p.category::text);
    after_j  := after_j  || jsonb_build_object('category', v_cat);
  END IF;
  IF v_site IS DISTINCT FROM p.website_url THEN
    changed := changed || 'website_url';
    before_j := before_j || jsonb_build_object('website_url', p.website_url);
    after_j  := after_j  || jsonb_build_object('website_url', v_site);
  END IF;
  IF v_maps IS DISTINCT FROM p.google_maps_url THEN
    changed := changed || 'google_maps_url';
    before_j := before_j || jsonb_build_object('google_maps_url', p.google_maps_url);
    after_j  := after_j  || jsonb_build_object('google_maps_url', v_maps);
  END IF;
  IF _latitude IS DISTINCT FROM p.latitude OR _longitude IS DISTINCT FROM p.longitude THEN
    changed := changed || 'coordinates';
    before_j := before_j || jsonb_build_object('latitude', p.latitude, 'longitude', p.longitude);
    after_j  := after_j  || jsonb_build_object('latitude', _latitude, 'longitude', _longitude);
  END IF;
  IF v_desc IS DISTINCT FROM p.description THEN
    changed := changed || 'description';
    before_j := before_j || jsonb_build_object('description', p.description);
    after_j  := after_j  || jsonb_build_object('description', v_desc);
  END IF;

  IF array_length(changed, 1) IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_changes');
  END IF;

  -- ---- identity safety (documented heuristic, not proof of identity) ----
  IF 'coordinates' = ANY(changed) THEN
    v_dist := public._detail_distance_m(p.latitude, p.longitude, _latitude, _longitude);
    IF v_dist IS NOT NULL AND v_dist > 1000 THEN
      risks := risks || 'coordinates_moved_far'; hard_block := true;
    ELSIF v_dist IS NOT NULL AND v_dist > 250 THEN
      risks := risks || 'coordinates_moved';
    END IF;
  END IF;
  IF 'name' = ANY(changed) THEN
    v_name_overlap := public._detail_token_overlap(p.name, v_name);
    IF v_name_overlap < 0.34
       AND position(public._detail_norm(v_name) in public._detail_norm(p.name)) = 0
       AND position(public._detail_norm(p.name) in public._detail_norm(v_name)) = 0 THEN
      risks := risks || 'name_changed_substantially'; hard_block := true;
    ELSIF v_name_overlap < 0.7 THEN
      risks := risks || 'name_changed';
    END IF;
  END IF;
  IF 'address' = ANY(changed) THEN
    v_addr_overlap := public._detail_token_overlap(p.address, v_addr);
    IF v_addr_overlap < 0.34 THEN
      risks := risks || 'address_changed_substantially'; hard_block := true;
    ELSIF v_addr_overlap < 0.7 THEN
      risks := risks || 'address_changed';
    END IF;
  END IF;
  IF 'category' = ANY(changed) AND p.category::text IN ('restaurant','cafe','market')
     AND v_cat IN ('park','studio','venue') THEN
    risks := risks || 'category_inconsistent';
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

  -- ---- public update + immutable audit, one transaction ----
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
$$;

-- Owner-gated inside; still revoke PUBLIC/anon per project convention.
REVOKE ALL ON FUNCTION public.get_community_place_edit_workspace(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_community_place_detail_changes(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_community_place_details(
  uuid, text, text, text, text, text, text, double precision, double precision,
  text, text, text, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._detail_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unaccent_fallback(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._detail_token_overlap(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._detail_distance_m(double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._detail_url_ok(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_community_place_edit_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_community_place_detail_changes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_community_place_details(
  uuid, text, text, text, text, text, text, double precision, double precision,
  text, text, text, text, uuid, boolean) TO authenticated;
