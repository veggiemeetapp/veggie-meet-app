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
           p.google_place_id,
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

  SELECT coalesce(json_agg(to_json(v) ORDER BY v.started_at DESC), '[]'::json) INTO v_reverif FROM (
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

REVOKE ALL ON FUNCTION public.get_community_place_edit_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_place_edit_workspace(uuid) TO authenticated;
