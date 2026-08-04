-- WO-058 — Community Place vegan verification status changes (owner-only)

-- 1) New classification value: place is no longer confirmed fully vegan.
--    Non-accusatory, preserves the record, distinct from operational closure.
ALTER TABLE public.community_places
  DROP CONSTRAINT IF EXISTS community_places_veggie_classification_check;
ALTER TABLE public.community_places
  ADD CONSTRAINT community_places_veggie_classification_check
  CHECK (veggie_classification IS NULL OR veggie_classification = ANY (ARRAY[
    'fully_vegan','fully_vegetarian','vegetarian_friendly','vegan_options',
    'not_food','not_confirmed_fully_vegan'
  ]));

-- 2) Private append-only vegan review audit
CREATE TABLE public.community_place_vegan_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  community_place_id uuid NOT NULL REFERENCES public.community_places(id),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','cancelled')),
  result text
    CHECK (result IS NULL OR result IN (
      'confirmed_fully_vegan','insufficient_evidence','no_longer_fully_vegan','cancelled')),
  started_by uuid REFERENCES public.profiles(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  evidence_source_url text,
  evidence_summary text,
  owner_note text,
  source_checks text[] NOT NULL DEFAULT '{}'::text[],
  product_checks text[] NOT NULL DEFAULT '{}'::text[],
  identity_checks text[] NOT NULL DEFAULT '{}'::text[],
  evidence_confidence text,
  prior_classification text,
  resulting_classification text,
  public_action text,
  public_action_applied boolean NOT NULL DEFAULT false,
  related_reverification_id uuid REFERENCES public.community_place_reverifications(id),
  related_report_id uuid REFERENCES public.community_place_reports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one open review per place.
CREATE UNIQUE INDEX community_place_vegan_reviews_one_open
  ON public.community_place_vegan_reviews (community_place_id)
  WHERE status = 'in_progress';
CREATE INDEX community_place_vegan_reviews_place_idx
  ON public.community_place_vegan_reviews (community_place_id, created_at DESC);

-- Owner-only read. No anon. No client writes at all.
GRANT SELECT ON public.community_place_vegan_reviews TO authenticated;
GRANT ALL ON public.community_place_vegan_reviews TO service_role;
ALTER TABLE public.community_place_vegan_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read vegan reviews"
  ON public.community_place_vegan_reviews FOR SELECT TO authenticated
  USING (public.is_owner());

-- 3) Private immutable vegan classification history
CREATE TABLE public.community_place_vegan_classification_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  community_place_id uuid NOT NULL REFERENCES public.community_places(id),
  old_classification text,
  new_classification text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'vegan_status_confirmed','vegan_status_unconfirmed','vegan_status_revoked')),
  internal_reason text,
  changed_by uuid REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  vegan_review_id uuid REFERENCES public.community_place_vegan_reviews(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_place_vegan_class_hist_place_idx
  ON public.community_place_vegan_classification_history (community_place_id, changed_at DESC);

GRANT SELECT ON public.community_place_vegan_classification_history TO authenticated;
GRANT ALL ON public.community_place_vegan_classification_history TO service_role;
ALTER TABLE public.community_place_vegan_classification_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read vegan classification history"
  ON public.community_place_vegan_classification_history FOR SELECT TO authenticated
  USING (public.is_owner());

-- 4) Immutability guards (SECURITY DEFINER RPCs bypass RLS, so enforce in triggers)
CREATE OR REPLACE FUNCTION public.guard_vegan_review_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'Completed vegan reviews are immutable.' USING errcode = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Completed vegan reviews are immutable.' USING errcode = '42501';
  END IF;
  NEW.id := OLD.id;
  NEW.community_place_id := OLD.community_place_id;
  NEW.started_by := OLD.started_by;
  NEW.started_at := OLD.started_at;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END; $fn$;

CREATE TRIGGER community_place_vegan_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.community_place_vegan_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_vegan_review_immutable();

CREATE OR REPLACE FUNCTION public.guard_vegan_class_history_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RAISE EXCEPTION 'Vegan classification history is append-only.' USING errcode = '42501';
END; $fn$;

CREATE TRIGGER community_place_vegan_class_history_append_only
  BEFORE UPDATE OR DELETE ON public.community_place_vegan_classification_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_vegan_class_history_append_only();

-- 5) Reactivation must never restore a place whose vegan status was revoked.
CREATE OR REPLACE FUNCTION public.set_community_place_active(_place_id uuid, _active boolean, _note text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  p RECORD;
  clean_note text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  IF _active IS NULL THEN
    RAISE EXCEPTION 'Specify whether the place should be active.';
  END IF;

  clean_note := nullif(btrim(coalesce(_note, '')), '');
  IF clean_note IS NULL THEN
    RAISE EXCEPTION 'An internal note is required.';
  END IF;
  IF length(clean_note) > 500 THEN
    RAISE EXCEPTION 'Internal note must be 500 characters or fewer.';
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  IF COALESCE(p.verification_status, '') <> 'verified' THEN
    RAISE EXCEPTION 'Only published Community Places can change visibility.';
  END IF;

  IF _active AND COALESCE(p.maintenance_status, 'operational') <> 'operational' THEN
    RAISE EXCEPTION 'Only operational places can be made visible.';
  END IF;

  -- WO-058: visibility can never bypass vegan verification.
  IF _active AND COALESCE(p.veggie_classification, '') <> 'fully_vegan' THEN
    RAISE EXCEPTION 'This place can only become visible again once its 100%% vegan status is reconfirmed through Review vegan status.';
  END IF;

  IF p.is_active = _active THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'place_id', _place_id,
                              'is_active', p.is_active,
                              'maintenance_status', p.maintenance_status);
  END IF;

  UPDATE public.community_places
     SET is_active = _active, updated_at = now()
   WHERE id = _place_id;

  INSERT INTO public.community_place_status_history (
    community_place_id, old_status, new_status, old_is_active, new_is_active,
    action, note, changed_by
  ) VALUES (
    _place_id, p.maintenance_status, COALESCE(p.maintenance_status, 'operational'),
    p.is_active, _active,
    CASE WHEN _active THEN 'reactivated' ELSE 'deactivated' END,
    clean_note, me
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'place_id', _place_id,
                            'is_active', _active,
                            'maintenance_status', p.maintenance_status);
END; $function$;

-- 6) Workspace (owner-only, read-only)
CREATE OR REPLACE FUNCTION public.get_community_place_vegan_review_workspace(
  _place_id uuid,
  _report_id uuid DEFAULT NULL,
  _reverification_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  place jsonb; review jsonb; reports jsonb; history jsonb; class_hist jsonb;
  rel_report jsonb; rel_rev jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT to_jsonb(t) INTO place FROM (
    SELECT p.id, p.name, p.address, p.neighborhood, p.category::text AS category,
           p.is_active,
           COALESCE(p.maintenance_status,'operational') AS maintenance_status,
           p.verification_status, p.veggie_classification, p.veggie_reason,
           p.website_url, p.google_maps_url,
           p.verified_at, p.last_reverified_at,
           (p.google_place_id IS NOT NULL) AS has_google_place_id,
           public.place_freshness_label(p.verified_at, p.last_reverified_at) AS freshness
      FROM public.community_places p
     WHERE p.id = _place_id AND p.verification_status = 'verified'
  ) t;

  IF place IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  SELECT to_jsonb(r) INTO review
    FROM public.community_place_vegan_reviews r
   WHERE r.community_place_id = _place_id AND r.status = 'in_progress'
   LIMIT 1;

  -- Vegan-related open member reports only. Reporter identity is never included.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', rp.id, 'reason_code', rp.reason_code,
           'explanation', rp.explanation,
           'official_source_url', rp.official_source_url,
           'status', rp.status, 'created_at', rp.created_at
         ) ORDER BY rp.created_at ASC), '[]'::jsonb)
    INTO reports
    FROM public.community_place_reports rp
   WHERE rp.community_place_id = _place_id
     AND rp.status IN ('pending','under_review')
     AND rp.reason_code = 'vegan_status_concern';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'status', r.status, 'result', r.result,
           'started_at', r.started_at, 'completed_at', r.completed_at,
           'evidence_source_url', r.evidence_source_url,
           'evidence_summary', r.evidence_summary,
           'owner_note', r.owner_note,
           'evidence_confidence', r.evidence_confidence,
           'prior_classification', r.prior_classification,
           'resulting_classification', r.resulting_classification,
           'public_action', r.public_action,
           'public_action_applied', r.public_action_applied,
           'related_report_id', r.related_report_id,
           'related_reverification_id', r.related_reverification_id
         ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO history
    FROM public.community_place_vegan_reviews r
   WHERE r.community_place_id = _place_id AND r.status <> 'in_progress';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', h.id, 'old_classification', h.old_classification,
           'new_classification', h.new_classification, 'action', h.action,
           'internal_reason', h.internal_reason, 'changed_at', h.changed_at,
           'vegan_review_id', h.vegan_review_id
         ) ORDER BY h.changed_at DESC), '[]'::jsonb)
    INTO class_hist
    FROM public.community_place_vegan_classification_history h
   WHERE h.community_place_id = _place_id;

  IF _report_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', rp.id, 'reason_code', rp.reason_code,
                              'explanation', rp.explanation,
                              'official_source_url', rp.official_source_url,
                              'additional_details', rp.additional_details,
                              'status', rp.status, 'created_at', rp.created_at)
      INTO rel_report
      FROM public.community_place_reports rp
     WHERE rp.id = _report_id AND rp.community_place_id = _place_id;
  END IF;

  IF _reverification_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', rv.id, 'result', rv.result, 'status', rv.status,
                              'completed_at', rv.completed_at,
                              'owner_note', rv.owner_note,
                              'official_source_url', rv.official_source_url,
                              'vegan_status_observed', rv.vegan_status_observed)
      INTO rel_rev
      FROM public.community_place_reverifications rv
     WHERE rv.id = _reverification_id AND rv.community_place_id = _place_id;
  END IF;

  RETURN jsonb_build_object(
    'place', place,
    'open_review', review,
    'open_vegan_reports', reports,
    'history', history,
    'classification_history', class_hist,
    'related_report', rel_report,
    'related_reverification', rel_rev
  );
END; $fn$;

-- 7) Start (idempotent)
CREATE OR REPLACE FUNCTION public.start_community_place_vegan_review(_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE me uuid; p RECORD; existing RECORD; new_id uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL OR COALESCE(p.verification_status,'') <> 'verified' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_not_published');
  END IF;

  SELECT * INTO existing FROM public.community_place_vegan_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress'
   FOR UPDATE LIMIT 1;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'review_id', existing.id,
                              'started_at', existing.started_at);
  END IF;

  INSERT INTO public.community_place_vegan_reviews (
    community_place_id, status, started_by, prior_classification
  ) VALUES (_place_id, 'in_progress', me, p.veggie_classification)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'review_id', new_id);
END; $fn$;

-- 8) Cancel (no public change)
CREATE OR REPLACE FUNCTION public.cancel_community_place_vegan_review(_place_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE me uuid; r RECORD;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT * INTO r FROM public.community_place_vegan_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress'
   FOR UPDATE LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_review');
  END IF;

  UPDATE public.community_place_vegan_reviews
     SET status = 'cancelled', result = 'cancelled',
         completed_by = me, completed_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'review_id', r.id);
END; $fn$;

-- 9) Complete (all-or-nothing; public consequences derived server-side)
CREATE OR REPLACE FUNCTION public.complete_community_place_vegan_review(
  _place_id uuid,
  _result text,
  _evidence_summary text,
  _owner_note text,
  _evidence_confidence text,
  _source_checks text[] DEFAULT '{}'::text[],
  _product_checks text[] DEFAULT '{}'::text[],
  _identity_checks text[] DEFAULT '{}'::text[],
  _evidence_source_url text DEFAULT NULL,
  _public_action text DEFAULT 'none',
  _confirm_public_action boolean DEFAULT false,
  _related_report_id uuid DEFAULT NULL,
  _related_reverification_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  me uuid; p RECORD; r RECORD;
  v_summary text; v_note text; v_url text; v_action text;
  v_rep uuid; v_rev uuid;
  src_ok  text[] := ARRAY['source_reachable','source_belongs_to_business','source_current','source_states_fully_vegan'];
  prod_ok text[] := ARRAY['no_meat','no_fish','no_dairy','no_egg','no_other_non_vegan','no_mixed_menu'];
  ident_ok text[] := ARRAY['same_business','same_branch','name_address_match','not_different_business'];
  new_class text;
  hist_action text;
  applied boolean := false;
  freshness_updated boolean := false;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  IF _result IS NULL OR _result NOT IN
     ('confirmed_fully_vegan','insufficient_evidence','no_longer_fully_vegan') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_result');
  END IF;

  IF _evidence_confidence IS NULL OR _evidence_confidence NOT IN
     ('confirms_fully_vegan','ambiguous','shows_non_vegan','no_source') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_evidence_confidence');
  END IF;

  IF NOT (_source_checks   <@ src_ok)  THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_source_checks'); END IF;
  IF NOT (_product_checks  <@ prod_ok) THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_product_checks'); END IF;
  IF NOT (_identity_checks <@ ident_ok) THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_checks'); END IF;

  v_summary := btrim(coalesce(_evidence_summary, ''));
  IF char_length(v_summary) < 20 OR char_length(v_summary) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_evidence_summary');
  END IF;

  v_note := btrim(coalesce(_owner_note, ''));
  IF char_length(v_note) = 0 OR char_length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_owner_note');
  END IF;

  v_url := nullif(btrim(coalesce(_evidence_source_url, '')), '');
  IF v_url IS NOT NULL AND NOT public._detail_url_ok(v_url) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_evidence_url');
  END IF;

  -- Evidence standard: first-party source required to confirm or to revoke.
  IF _result IN ('confirmed_fully_vegan','no_longer_fully_vegan') AND v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'evidence_url_required');
  END IF;
  IF _result = 'insufficient_evidence' AND v_url IS NULL
     AND _evidence_confidence <> 'no_source' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'evidence_url_required');
  END IF;

  -- Contradiction guards
  IF _result = 'confirmed_fully_vegan' THEN
    IF _evidence_confidence <> 'confirms_fully_vegan' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_confidence');
    END IF;
    IF NOT (src_ok <@ _source_checks) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'incomplete_source_checks');
    END IF;
    IF NOT (prod_ok <@ _product_checks) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_product_checks');
    END IF;
    IF NOT (ident_ok <@ _identity_checks) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'identity_not_established');
    END IF;
  ELSIF _result = 'no_longer_fully_vegan' THEN
    IF _evidence_confidence <> 'shows_non_vegan' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_confidence');
    END IF;
    IF prod_ok <@ _product_checks THEN
      -- every non-vegan category was ruled out, yet the result says otherwise
      RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_product_checks');
    END IF;
    IF NOT (ident_ok <@ _identity_checks) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'identity_not_established');
    END IF;
    IF NOT ('source_belongs_to_business' = ANY(_source_checks)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'identity_not_established');
    END IF;
  ELSE
    IF _evidence_confidence NOT IN ('ambiguous','no_source') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'contradictory_confidence');
    END IF;
  END IF;

  -- Public action shape
  v_action := coalesce(nullif(btrim(coalesce(_public_action,'')), ''), 'none');
  IF _result = 'confirmed_fully_vegan' AND v_action <> 'none' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_public_action');
  END IF;
  IF _result = 'insufficient_evidence' AND v_action NOT IN ('none','deactivate') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_public_action');
  END IF;
  IF _result = 'no_longer_fully_vegan' AND v_action <> 'revoke_and_deactivate' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_public_action');
  END IF;
  IF v_action <> 'none' AND _confirm_public_action IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'confirmation_required');
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL OR COALESCE(p.verification_status,'') <> 'verified' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_not_published');
  END IF;

  SELECT * INTO r FROM public.community_place_vegan_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress'
   FOR UPDATE LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_review');
  END IF;

  -- Related records must belong to this place and be of the right kind.
  IF _related_report_id IS NOT NULL THEN
    SELECT id INTO v_rep FROM public.community_place_reports
     WHERE id = _related_report_id AND community_place_id = _place_id
       AND reason_code = 'vegan_status_concern';
    IF v_rep IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_related_report');
    END IF;
  END IF;
  IF _related_reverification_id IS NOT NULL THEN
    SELECT id INTO v_rev FROM public.community_place_reverifications
     WHERE id = _related_reverification_id AND community_place_id = _place_id
       AND status = 'completed';
    IF v_rev IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_related_reverification');
    END IF;
  END IF;

  new_class := p.veggie_classification;
  hist_action := CASE _result
    WHEN 'confirmed_fully_vegan'   THEN 'vegan_status_confirmed'
    WHEN 'insufficient_evidence'   THEN 'vegan_status_unconfirmed'
    ELSE 'vegan_status_revoked' END;

  IF _result = 'no_longer_fully_vegan' THEN
    new_class := 'not_confirmed_fully_vegan';
    UPDATE public.community_places
       SET veggie_classification = new_class, updated_at = now()
     WHERE id = _place_id;
    applied := true;
  END IF;

  -- Freshness rule: a completed vegan confirmation backed by a current
  -- first-party source satisfies the WO-056 reverification evidence bar for the
  -- vegan dimension, so last_reverified_at advances. verified_at never changes.
  IF _result = 'confirmed_fully_vegan' THEN
    UPDATE public.community_places
       SET last_reverified_at = now(), updated_at = now()
     WHERE id = _place_id;
    freshness_updated := true;
  END IF;

  -- Complete the audit record before any activation change.
  UPDATE public.community_place_vegan_reviews
     SET status = 'completed', result = _result,
         completed_by = me, completed_at = now(),
         evidence_source_url = v_url,
         evidence_summary = v_summary,
         owner_note = v_note,
         source_checks = _source_checks,
         product_checks = _product_checks,
         identity_checks = _identity_checks,
         evidence_confidence = _evidence_confidence,
         prior_classification = p.veggie_classification,
         resulting_classification = new_class,
         public_action = v_action,
         public_action_applied = (v_action <> 'none'),
         related_report_id = v_rep,
         related_reverification_id = v_rev
   WHERE id = r.id;

  INSERT INTO public.community_place_vegan_classification_history (
    community_place_id, old_classification, new_classification, action,
    internal_reason, changed_by, vegan_review_id
  ) VALUES (
    _place_id, p.veggie_classification, new_class, hist_action, v_note, me, r.id
  );

  -- Visibility change always runs through the existing activation workflow.
  IF v_action IN ('deactivate','revoke_and_deactivate') THEN
    PERFORM public.set_community_place_active(
      _place_id, false,
      CASE WHEN _result = 'no_longer_fully_vegan'
        THEN 'Vegan review: 100% vegan status revoked — hidden from Community Places discovery.'
        ELSE 'Vegan review: current 100% vegan evidence could not be confirmed — temporarily hidden.'
      END);
    applied := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'review_id', r.id,
    'result', _result,
    'public_action', v_action,
    'public_action_applied', (v_action <> 'none'),
    'classification', new_class,
    'freshness_updated', freshness_updated,
    'needs_action', (_result <> 'confirmed_fully_vegan')
  );
END; $fn$;

-- 10) Execution model: owner-gated functions, never PUBLIC or anon.
REVOKE ALL ON FUNCTION public.get_community_place_vegan_review_workspace(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_community_place_vegan_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_community_place_vegan_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_community_place_vegan_review(uuid, text, text, text, text, text[], text[], text[], text, text, boolean, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_vegan_review_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_vegan_class_history_append_only() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_community_place_vegan_review_workspace(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_community_place_vegan_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_community_place_vegan_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_community_place_vegan_review(uuid, text, text, text, text, text[], text[], text[], text, text, boolean, uuid, uuid) TO authenticated;