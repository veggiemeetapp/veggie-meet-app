-- WO-059 — Community Place identity replacement and location moves.

CREATE TABLE public.community_place_identity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','cancelled')),
  case_type text
    CHECK (case_type IS NULL OR case_type IN (
      'same_business_same_branch','same_business_branch_moved',
      'different_branch','different_business_or_unclear')),
  result text
    CHECK (result IS NULL OR result IN (
      'identity_replaced','location_moved','new_branch_required',
      'different_business','insufficient_evidence','no_change','cancelled')),
  started_by uuid REFERENCES public.profiles(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  old_google_place_id text,
  proposed_google_place_id text,
  old_name text,
  proposed_name text,
  old_address text,
  proposed_address text,
  old_latitude double precision,
  old_longitude double precision,
  proposed_latitude double precision,
  proposed_longitude double precision,
  official_source_url text,
  evidence_summary text,
  owner_note text,
  distance_meters double precision,
  same_business_confirmed boolean NOT NULL DEFAULT false,
  same_branch_confirmed boolean NOT NULL DEFAULT false,
  relocation_confirmed boolean NOT NULL DEFAULT false,
  public_action_applied boolean NOT NULL DEFAULT false,
  created_candidate_id uuid REFERENCES public.place_candidates(id) ON DELETE SET NULL,
  related_reverification_id uuid REFERENCES public.community_place_reverifications(id) ON DELETE SET NULL,
  related_report_id uuid REFERENCES public.community_place_reports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.community_place_identity_reviews TO authenticated;
GRANT ALL ON public.community_place_identity_reviews TO service_role;
ALTER TABLE public.community_place_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads identity reviews"
  ON public.community_place_identity_reviews FOR SELECT TO authenticated
  USING (public.is_owner());

CREATE UNIQUE INDEX community_place_identity_reviews_one_open
  ON public.community_place_identity_reviews (community_place_id)
  WHERE status = 'in_progress';
CREATE INDEX community_place_identity_reviews_place_idx
  ON public.community_place_identity_reviews (community_place_id, created_at DESC);
CREATE INDEX community_place_identity_reviews_proposed_idx
  ON public.community_place_identity_reviews (proposed_google_place_id)
  WHERE status = 'in_progress' AND proposed_google_place_id IS NOT NULL;

CREATE TRIGGER community_place_identity_reviews_updated_at
  BEFORE UPDATE ON public.community_place_identity_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Immutable, owner-only history of APPLIED identity changes.
CREATE TABLE public.community_place_identity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  identity_review_id uuid REFERENCES public.community_place_identity_reviews(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'google_identity_replaced','branch_relocated','identity_review_rejected')),
  old_google_place_id text,
  new_google_place_id text,
  old_address text,
  new_address text,
  old_latitude double precision,
  old_longitude double precision,
  new_latitude double precision,
  new_longitude double precision,
  changed_by uuid REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  internal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.community_place_identity_history TO authenticated;
GRANT ALL ON public.community_place_identity_history TO service_role;
ALTER TABLE public.community_place_identity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads identity history"
  ON public.community_place_identity_history FOR SELECT TO authenticated
  USING (public.is_owner());
CREATE INDEX community_place_identity_history_place_idx
  ON public.community_place_identity_history (community_place_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.guard_identity_history_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Community Place identity history is append-only.' USING errcode = '42501';
END; $$;

CREATE TRIGGER community_place_identity_history_no_update
  BEFORE UPDATE ON public.community_place_identity_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_identity_history_append_only();
CREATE TRIGGER community_place_identity_history_no_delete
  BEFORE DELETE ON public.community_place_identity_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_identity_history_append_only();

-- Completed identity reviews are immutable.
CREATE OR REPLACE FUNCTION public.guard_identity_review_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status <> 'in_progress' THEN
    RAISE EXCEPTION 'A completed identity review cannot be changed.' USING errcode = '42501';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER community_place_identity_reviews_immutable
  BEFORE UPDATE ON public.community_place_identity_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_identity_review_immutable();

-- ---------------------------------------------------------------- workspace
CREATE OR REPLACE FUNCTION public.get_community_place_identity_review_workspace(
  _place_id uuid, _report_id uuid DEFAULT NULL, _reverification_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  place jsonb; review jsonb; reviews jsonb; hist jsonb;
  rel_report jsonb; rel_rev jsonb; reports jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT to_jsonb(t) INTO place FROM (
    SELECT p.id, p.name, p.address, p.neighborhood, p.category::text AS category,
           p.latitude, p.longitude, p.google_place_id, p.google_maps_url,
           p.website_url, p.business_status, p.is_active,
           COALESCE(p.maintenance_status,'operational') AS maintenance_status,
           p.verification_status, p.veggie_classification,
           p.verified_at, p.last_reverified_at,
           public.place_freshness_label(p.verified_at, p.last_reverified_at) AS freshness
      FROM public.community_places p
     WHERE p.id = _place_id AND p.verification_status = 'verified'
  ) t;
  IF place IS NULL THEN RAISE EXCEPTION 'Place not found.'; END IF;

  SELECT to_jsonb(r) INTO review
    FROM public.community_place_identity_reviews r
   WHERE r.community_place_id = _place_id AND r.status = 'in_progress' LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO reviews FROM public.community_place_identity_reviews r
   WHERE r.community_place_id = _place_id AND r.status <> 'in_progress';

  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.changed_at DESC), '[]'::jsonb)
    INTO hist FROM public.community_place_identity_history h
   WHERE h.community_place_id = _place_id;

  -- Identity-related open member reports. Reporter identity is never included.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', rp.id, 'reason_code', rp.reason_code, 'explanation', rp.explanation,
           'official_source_url', rp.official_source_url, 'status', rp.status,
           'created_at', rp.created_at) ORDER BY rp.created_at ASC), '[]'::jsonb)
    INTO reports FROM public.community_place_reports rp
   WHERE rp.community_place_id = _place_id
     AND rp.status IN ('pending','under_review')
     AND rp.reason_code IN ('incorrect_location','duplicate_place','incorrect_source','incorrect_name');

  IF _report_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', rp.id, 'reason_code', rp.reason_code,
             'explanation', rp.explanation, 'official_source_url', rp.official_source_url,
             'status', rp.status, 'created_at', rp.created_at)
      INTO rel_report FROM public.community_place_reports rp
     WHERE rp.id = _report_id AND rp.community_place_id = _place_id;
  END IF;

  IF _reverification_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result,
             'completed_at', r.completed_at, 'owner_note', r.owner_note,
             'official_source_url', r.official_source_url,
             'google_status_observed', r.google_status_observed)
      INTO rel_rev FROM public.community_place_reverifications r
     WHERE r.id = _reverification_id AND r.community_place_id = _place_id;
  END IF;

  RETURN jsonb_build_object(
    'place', place, 'open_review', review, 'history', reviews,
    'identity_history', hist, 'open_identity_reports', reports,
    'related_report', rel_report, 'related_reverification', rel_rev);
END; $$;

-- ---------------------------------------------------------------- start
CREATE OR REPLACE FUNCTION public.start_community_place_identity_review(_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE me uuid; p RECORD; existing uuid; new_id uuid;
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

  SELECT id INTO existing FROM public.community_place_identity_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress' LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'review_id', existing);
  END IF;

  INSERT INTO public.community_place_identity_reviews (
    community_place_id, started_by, old_google_place_id, old_name, old_address,
    old_latitude, old_longitude)
  VALUES (_place_id, me, p.google_place_id, p.name, p.address, p.latitude, p.longitude)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'review_id', new_id);
END; $$;

-- ---------------------------------------------------------------- cancel
CREATE OR REPLACE FUNCTION public.cancel_community_place_identity_review(_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE me uuid; r RECORD;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT * INTO r FROM public.community_place_identity_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress' FOR UPDATE LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_review');
  END IF;

  UPDATE public.community_place_identity_reviews
     SET status = 'cancelled', result = 'cancelled', completed_by = me, completed_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'review_id', r.id);
END; $$;

-- ---------------------------------------------------------------- complete
CREATE OR REPLACE FUNCTION public.complete_community_place_identity_review(
  _place_id uuid,
  _case_type text,
  _result text,
  _proposed_google_place_id text DEFAULT NULL,
  _proposed_name text DEFAULT NULL,
  _proposed_address text DEFAULT NULL,
  _proposed_neighborhood text DEFAULT NULL,
  _proposed_latitude double precision DEFAULT NULL,
  _proposed_longitude double precision DEFAULT NULL,
  _proposed_maps_url text DEFAULT NULL,
  _proposed_website_url text DEFAULT NULL,
  _official_source_url text DEFAULT NULL,
  _evidence_summary text DEFAULT NULL,
  _owner_note text DEFAULT NULL,
  _same_business_confirmed boolean DEFAULT false,
  _same_branch_confirmed boolean DEFAULT false,
  _relocation_confirmed boolean DEFAULT false,
  _apply_google_identity boolean DEFAULT false,
  _apply_name boolean DEFAULT false,
  _apply_location boolean DEFAULT false,
  _apply_website boolean DEFAULT false,
  _confirm_public_action boolean DEFAULT false,
  _acknowledge_large_move boolean DEFAULT false,
  _create_candidate boolean DEFAULT false,
  _related_report_id uuid DEFAULT NULL,
  _related_reverification_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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

  -- 1. Case and result vocabulary --------------------------------------
  IF _case_type IS NULL OR _case_type NOT IN ('same_business_same_branch',
        'same_business_branch_moved','different_branch','different_business_or_unclear') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_case_type');
  END IF;
  IF _result IS NULL OR _result NOT IN ('identity_replaced','location_moved',
        'new_branch_required','different_business','insufficient_evidence') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_result');
  END IF;

  -- 2. Case/result matrix ----------------------------------------------
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

  -- 3. Structured identity confirmations -------------------------------
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

  -- 4. Evidence --------------------------------------------------------
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

  -- 5. Proposed Google identity ---------------------------------------
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

  -- 6. Server-side distance guidance ----------------------------------
  dist := public._detail_distance_m(p.latitude, p.longitude, _proposed_latitude, _proposed_longitude);

  IF _result = 'location_moved' THEN
    IF _proposed_address IS NULL OR btrim(_proposed_address) = ''
       OR _proposed_latitude IS NULL OR _proposed_longitude IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'proposed_location_required');
    END IF;
    IF dist IS NOT NULL AND dist > 10000 AND NOT _acknowledge_large_move THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'large_move_not_acknowledged',
                                'distance_meters', round(dist));
    END IF;
  END IF;
  IF _result = 'identity_replaced' AND _apply_location
     AND dist IS NOT NULL AND dist > 1000 AND NOT _acknowledge_large_move THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'large_move_not_acknowledged',
                              'distance_meters', round(dist));
  END IF;

  -- 7. Explicit confirmation for public changes -----------------------
  IF _result IN ('identity_replaced','location_moved') AND NOT no_op
     AND NOT _confirm_public_action THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'confirmation_required');
  END IF;

  -- 8. Related records must belong to this place ----------------------
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

  -- 9. Apply the approved public change ------------------------------
  IF _result IN ('identity_replaced','location_moved') AND NOT no_op THEN
    new_gid := p.google_place_id; new_addr := p.address; new_nb := p.neighborhood;
    new_lat := p.latitude; new_lng := p.longitude; new_maps := p.google_maps_url;
    new_web := p.website_url; new_name := p.name;

    IF (_result = 'identity_replaced' AND _apply_google_identity)
       OR (_result = 'location_moved' AND _proposed_google_place_id IS NOT NULL) THEN
      IF _proposed_google_place_id IS NOT NULL AND _proposed_google_place_id IS DISTINCT FROM new_gid THEN
        new_gid := _proposed_google_place_id; changed := changed || 'google_place_id';
      END IF;
      IF _proposed_maps_url IS NOT NULL AND btrim(_proposed_maps_url) <> ''
         AND btrim(_proposed_maps_url) IS DISTINCT FROM new_maps THEN
        new_maps := btrim(_proposed_maps_url); changed := changed || 'google_maps_url';
      END IF;
    END IF;

    IF _apply_name AND _proposed_name IS NOT NULL AND btrim(_proposed_name) <> ''
       AND char_length(btrim(_proposed_name)) <= 200
       AND btrim(_proposed_name) IS DISTINCT FROM new_name THEN
      new_name := btrim(_proposed_name); changed := changed || 'name';
    END IF;

    IF (_result = 'location_moved') OR (_result = 'identity_replaced' AND _apply_location) THEN
      IF _proposed_address IS NOT NULL AND btrim(_proposed_address) <> ''
         AND btrim(_proposed_address) IS DISTINCT FROM new_addr THEN
        new_addr := btrim(_proposed_address); changed := changed || 'address';
      END IF;
      IF _proposed_neighborhood IS NOT NULL AND btrim(_proposed_neighborhood) <> ''
         AND btrim(_proposed_neighborhood) IS DISTINCT FROM new_nb THEN
        new_nb := btrim(_proposed_neighborhood); changed := changed || 'neighborhood';
      END IF;
      IF _proposed_latitude IS NOT NULL AND _proposed_longitude IS NOT NULL
         AND (_proposed_latitude IS DISTINCT FROM new_lat
              OR _proposed_longitude IS DISTINCT FROM new_lng) THEN
        new_lat := _proposed_latitude; new_lng := _proposed_longitude;
        changed := changed || 'coordinates';
      END IF;
    END IF;

    IF _apply_website AND _proposed_website_url IS NOT NULL
       AND btrim(_proposed_website_url) <> ''
       AND btrim(_proposed_website_url) IS DISTINCT FROM new_web THEN
      new_web := btrim(_proposed_website_url); changed := changed || 'website_url';
    END IF;

    IF array_length(changed, 1) > 0 THEN
      -- Vegan classification, maintenance status, active state, verification
      -- status and verified_at are deliberately NOT in this statement.
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

  -- 10. New branch: private candidate only, never a public place -------
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

  -- 11. Record the review -------------------------------------------
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
END; $$;

REVOKE ALL ON FUNCTION public.get_community_place_identity_review_workspace(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_community_place_identity_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_community_place_identity_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_community_place_identity_review(
  uuid, text, text, text, text, text, text, double precision, double precision, text, text,
  text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_community_place_identity_review_workspace(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_community_place_identity_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_community_place_identity_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_community_place_identity_review(
  uuid, text, text, text, text, text, text, double precision, double precision, text, text,
  text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.guard_identity_history_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_identity_review_immutable() FROM PUBLIC, anon, authenticated;