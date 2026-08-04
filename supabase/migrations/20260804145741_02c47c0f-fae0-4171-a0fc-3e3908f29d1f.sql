CREATE OR REPLACE FUNCTION public.complete_community_place_identity_review(_place_id uuid, _case_type text, _result text, _proposed_google_place_id text DEFAULT NULL::text, _proposed_name text DEFAULT NULL::text, _proposed_address text DEFAULT NULL::text, _proposed_neighborhood text DEFAULT NULL::text, _proposed_latitude double precision DEFAULT NULL::double precision, _proposed_longitude double precision DEFAULT NULL::double precision, _proposed_maps_url text DEFAULT NULL::text, _proposed_website_url text DEFAULT NULL::text, _official_source_url text DEFAULT NULL::text, _evidence_summary text DEFAULT NULL::text, _owner_note text DEFAULT NULL::text, _same_business_confirmed boolean DEFAULT false, _same_branch_confirmed boolean DEFAULT false, _relocation_confirmed boolean DEFAULT false, _apply_google_identity boolean DEFAULT false, _apply_name boolean DEFAULT false, _apply_location boolean DEFAULT false, _apply_website boolean DEFAULT false, _confirm_public_action boolean DEFAULT false, _acknowledge_large_move boolean DEFAULT false, _create_candidate boolean DEFAULT false, _related_report_id uuid DEFAULT NULL::uuid, _related_reverification_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid; p RECORD; rv RECORD;
  dist double precision; no_op boolean := false;
  applied boolean := false; cand_id uuid; conflict_kind text;
  new_gid text; new_addr text; new_nb text; new_lat double precision;
  new_lng double precision; new_maps text; new_web text; new_name text;
  changed text[] := '{}'; act text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT * INTO p FROM public.community_places
   WHERE id = _place_id AND verification_status = 'verified' FOR UPDATE;
  IF p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_not_published');
  END IF;

  SELECT * INTO rv FROM public.community_place_identity_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress' FOR UPDATE LIMIT 1;
  IF rv.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_review');
  END IF;

  IF _case_type IS NULL OR _case_type NOT IN ('same_business_same_branch',
        'same_business_branch_moved','different_branch','different_business_or_unclear') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_case_type');
  END IF;
  IF _result IS NULL OR _result NOT IN ('identity_replaced','location_moved',
        'new_branch_required','different_business','insufficient_evidence') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_result');
  END IF;

  IF _result = 'identity_replaced' AND _case_type <> 'same_business_same_branch' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_case_result');
  END IF;
  IF _result = 'location_moved' AND _case_type <> 'same_business_branch_moved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_case_result');
  END IF;
  IF _result = 'new_branch_required' AND _case_type <> 'different_branch' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_case_result');
  END IF;
  IF _result = 'different_business' AND _case_type <> 'different_business_or_unclear' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_case_result');
  END IF;

  IF _result IN ('identity_replaced','location_moved') THEN
    IF NOT _same_business_confirmed THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'same_business_not_confirmed');
    END IF;
    IF NOT _same_branch_confirmed THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'same_branch_not_confirmed');
    END IF;
  END IF;
  IF _result = 'location_moved' AND NOT _relocation_confirmed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'relocation_not_confirmed');
  END IF;

  IF _owner_note IS NULL OR btrim(_owner_note) = '' OR char_length(btrim(_owner_note)) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_owner_note');
  END IF;
  IF _evidence_summary IS NULL OR char_length(btrim(_evidence_summary)) < 20
     OR char_length(btrim(_evidence_summary)) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_evidence_summary');
  END IF;
  IF _official_source_url IS NOT NULL AND btrim(_official_source_url) <> ''
     AND NOT public._detail_url_ok(btrim(_official_source_url)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_evidence_url');
  END IF;
  IF _result IN ('identity_replaced','location_moved')
     AND (_official_source_url IS NULL OR btrim(_official_source_url) = '') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'evidence_url_required');
  END IF;

  IF _proposed_google_place_id IS NOT NULL AND btrim(_proposed_google_place_id) <> '' THEN
    IF btrim(_proposed_google_place_id) !~ '^[A-Za-z0-9_-]{5,200}$' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_google_place_id');
    END IF;
  ELSE
    _proposed_google_place_id := NULL;
  END IF;
  IF _result = 'identity_replaced' AND _proposed_google_place_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'google_place_id_required');
  END IF;

  IF _proposed_google_place_id IS NOT NULL THEN
    IF p.google_place_id IS NOT NULL AND p.google_place_id = _proposed_google_place_id THEN
      no_op := true;
    ELSE
      SELECT 'published_place' INTO conflict_kind FROM public.community_places c
       WHERE c.google_place_id = _proposed_google_place_id AND c.id <> _place_id LIMIT 1;
      IF conflict_kind IS NULL THEN
        SELECT 'candidate' INTO conflict_kind FROM public.place_candidates pc
         WHERE pc.google_place_id = _proposed_google_place_id
           AND COALESCE(pc.published_place_id, '00000000-0000-0000-0000-000000000000'::uuid) <> _place_id
         LIMIT 1;
      END IF;
      IF conflict_kind IS NULL THEN
        SELECT 'identity_review' INTO conflict_kind
          FROM public.community_place_identity_reviews r
         WHERE r.status = 'in_progress' AND r.id <> rv.id
           AND r.proposed_google_place_id = _proposed_google_place_id LIMIT 1;
      END IF;
      IF conflict_kind IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_google_place_id',
                                  'conflict', conflict_kind);
      END IF;
    END IF;
  END IF;

  dist := public._detail_distance_m(p.latitude, p.longitude, _proposed_latitude, _proposed_longitude);

  IF _result = 'location_moved' THEN
    IF _proposed_address IS NULL OR btrim(_proposed_address) = ''
       OR _proposed_latitude IS NULL OR _proposed_longitude IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'proposed_location_required');
    END IF;
    -- WO-059A: any move over 1 km must be explicitly acknowledged; over 10 km is
    -- flagged as exceptional so the owner UI can show its strongest warning.
    IF dist IS NOT NULL AND dist > 1000 AND NOT _acknowledge_large_move THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'large_move_not_acknowledged',
                                'distance_meters', round(dist),
                                'exceptional', dist > 10000);
    END IF;
  END IF;
  IF _result = 'identity_replaced' AND _apply_location
     AND dist IS NOT NULL AND dist > 1000 AND NOT _acknowledge_large_move THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'large_move_not_acknowledged',
                              'distance_meters', round(dist),
                              'exceptional', dist > 10000);
  END IF;

  IF _result IN ('identity_replaced','location_moved') AND NOT no_op
     AND NOT _confirm_public_action THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'confirmation_required');
  END IF;

  IF _related_report_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.community_place_reports rp
       WHERE rp.id = _related_report_id AND rp.community_place_id = _place_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_related_report');
  END IF;
  IF _related_reverification_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.community_place_reverifications r
       WHERE r.id = _related_reverification_id AND r.community_place_id = _place_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_related_reverification');
  END IF;

  IF _proposed_website_url IS NOT NULL AND btrim(_proposed_website_url) <> ''
     AND NOT public._detail_url_ok(btrim(_proposed_website_url)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_proposed_website');
  END IF;
  IF _proposed_maps_url IS NOT NULL AND btrim(_proposed_maps_url) <> ''
     AND NOT public._detail_url_ok(btrim(_proposed_maps_url)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_proposed_maps_url');
  END IF;

  IF _result IN ('identity_replaced','location_moved') AND NOT no_op THEN
    new_gid := p.google_place_id; new_addr := p.address; new_nb := p.neighborhood;
    new_lat := p.latitude; new_lng := p.longitude; new_maps := p.google_maps_url;
    new_web := p.website_url; new_name := p.name;

    IF (_result = 'identity_replaced' AND _apply_google_identity)
       OR (_result = 'location_moved' AND _proposed_google_place_id IS NOT NULL) THEN
      IF _proposed_google_place_id IS NOT NULL AND _proposed_google_place_id IS DISTINCT FROM new_gid THEN
        new_gid := _proposed_google_place_id;
        changed := array_append(changed, 'google_place_id');
        IF _proposed_maps_url IS NOT NULL AND btrim(_proposed_maps_url) <> '' THEN
          new_maps := btrim(_proposed_maps_url);
        ELSE
          new_maps := 'https://www.google.com/maps/place/?q=place_id:' || _proposed_google_place_id;
        END IF;
        changed := array_append(changed, 'google_maps_url');
      END IF;
    END IF;

    IF _apply_name AND _proposed_name IS NOT NULL AND btrim(_proposed_name) <> ''
       AND btrim(_proposed_name) IS DISTINCT FROM new_name THEN
      new_name := btrim(_proposed_name);
      changed := array_append(changed, 'name');
    END IF;

    IF _apply_location OR _result = 'location_moved' THEN
      IF _proposed_address IS NOT NULL AND btrim(_proposed_address) <> ''
         AND btrim(_proposed_address) IS DISTINCT FROM new_addr THEN
        new_addr := btrim(_proposed_address);
        changed := array_append(changed, 'address');
      END IF;
      IF _proposed_neighborhood IS NOT NULL AND btrim(_proposed_neighborhood) <> ''
         AND btrim(_proposed_neighborhood) IS DISTINCT FROM new_nb THEN
        new_nb := btrim(_proposed_neighborhood);
        changed := array_append(changed, 'neighborhood');
      END IF;
      IF _proposed_latitude IS NOT NULL AND _proposed_longitude IS NOT NULL
         AND (_proposed_latitude IS DISTINCT FROM new_lat
              OR _proposed_longitude IS DISTINCT FROM new_lng) THEN
        new_lat := _proposed_latitude; new_lng := _proposed_longitude;
        changed := array_append(changed, 'coordinates');
      END IF;
    END IF;

    IF _apply_website AND _proposed_website_url IS NOT NULL
       AND btrim(_proposed_website_url) <> ''
       AND btrim(_proposed_website_url) IS DISTINCT FROM new_web THEN
      new_web := btrim(_proposed_website_url);
      changed := array_append(changed, 'website_url');
    END IF;

    IF array_length(changed, 1) > 0 THEN
      UPDATE public.community_places
         SET google_place_id = new_gid, google_maps_url = new_maps, name = new_name,
             address = new_addr, neighborhood = new_nb,
             latitude = new_lat, longitude = new_lng, website_url = new_web,
             updated_at = now()
       WHERE id = _place_id;
      applied := true;

      act := CASE WHEN _result = 'location_moved' THEN 'branch_relocated'
                  ELSE 'google_identity_replaced' END;
      INSERT INTO public.community_place_identity_history (
        community_place_id, identity_review_id, action,
        old_google_place_id, new_google_place_id, old_address, new_address,
        old_latitude, old_longitude, new_latitude, new_longitude,
        changed_by, internal_reason)
      VALUES (_place_id, rv.id, act, p.google_place_id, new_gid, p.address, new_addr,
              p.latitude, p.longitude, new_lat, new_lng, me, btrim(_owner_note));
    ELSE
      no_op := true;
    END IF;
  END IF;

  IF _result = 'new_branch_required' AND _create_candidate THEN
    IF _proposed_google_place_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'google_place_id_required');
    END IF;
    IF EXISTS (SELECT 1 FROM public.place_candidates pc
                WHERE pc.google_place_id = _proposed_google_place_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_google_place_id',
                                'conflict', 'candidate');
    END IF;
    INSERT INTO public.place_candidates (
      google_place_id, google_display_name, google_formatted_address,
      google_maps_url, google_website_url, latitude, longitude,
      display_name, district, source, verification_status, verification_notes)
    VALUES (_proposed_google_place_id, NULLIF(btrim(COALESCE(_proposed_name,'')),''),
            NULLIF(btrim(COALESCE(_proposed_address,'')),''),
            NULLIF(btrim(COALESCE(_proposed_maps_url,'')),''),
            NULLIF(btrim(COALESCE(_proposed_website_url,'')),''),
            _proposed_latitude, _proposed_longitude,
            COALESCE(NULLIF(btrim(COALESCE(_proposed_name,'')),''), 'Untitled branch'),
            NULLIF(btrim(COALESCE(_proposed_neighborhood,'')),''),
            'owner_curated', 'draft',
            'Created from an identity review of another branch. Requires its own '
            || 'Google identity and 100% vegan verification before publication.')
    RETURNING id INTO cand_id;
  END IF;

  UPDATE public.community_place_identity_reviews
     SET status = 'completed',
         case_type = _case_type,
         result = CASE WHEN no_op AND _result IN ('identity_replaced','location_moved')
                       THEN 'no_change' ELSE _result END,
         completed_by = me, completed_at = now(),
         proposed_google_place_id = _proposed_google_place_id,
         proposed_name = NULLIF(btrim(COALESCE(_proposed_name,'')),''),
         proposed_address = NULLIF(btrim(COALESCE(_proposed_address,'')),''),
         proposed_latitude = _proposed_latitude,
         proposed_longitude = _proposed_longitude,
         official_source_url = NULLIF(btrim(COALESCE(_official_source_url,'')),''),
         evidence_summary = btrim(_evidence_summary),
         owner_note = btrim(_owner_note),
         distance_meters = dist,
         same_business_confirmed = _same_business_confirmed,
         same_branch_confirmed = _same_branch_confirmed,
         relocation_confirmed = _relocation_confirmed,
         public_action_applied = applied,
         created_candidate_id = cand_id,
         related_report_id = _related_report_id,
         related_reverification_id = _related_reverification_id
   WHERE id = rv.id;

  RETURN jsonb_build_object(
    'ok', true, 'review_id', rv.id,
    'result', CASE WHEN no_op AND _result IN ('identity_replaced','location_moved')
                   THEN 'no_change' ELSE _result END,
    'public_action_applied', applied, 'no_op', no_op,
    'distance_meters', CASE WHEN dist IS NULL THEN NULL ELSE round(dist) END,
    'changed_fields', to_jsonb(changed), 'candidate_id', cand_id);
END; $function$;

REVOKE ALL ON FUNCTION public.complete_community_place_identity_review(uuid, text, text, text, text, text, text, double precision, double precision, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_community_place_identity_review(uuid, text, text, text, text, text, text, double precision, double precision, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid) TO authenticated;