ALTER TABLE public.community_place_vegan_classification_history
  DROP CONSTRAINT community_place_vegan_classification_history_action_check;
ALTER TABLE public.community_place_vegan_classification_history
  ADD CONSTRAINT community_place_vegan_classification_history_action_check
  CHECK (action = ANY (ARRAY[
    'vegan_status_confirmed','vegan_status_unconfirmed',
    'vegan_status_revoked','vegan_status_restored']));

CREATE OR REPLACE FUNCTION public.complete_community_place_vegan_review(
  _place_id uuid, _result text, _evidence_summary text, _owner_note text,
  _evidence_confidence text, _source_checks text[] DEFAULT '{}'::text[],
  _product_checks text[] DEFAULT '{}'::text[], _identity_checks text[] DEFAULT '{}'::text[],
  _evidence_source_url text DEFAULT NULL::text, _public_action text DEFAULT 'none'::text,
  _confirm_public_action boolean DEFAULT false, _related_report_id uuid DEFAULT NULL::uuid,
  _related_reverification_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF _result IN ('confirmed_fully_vegan','no_longer_fully_vegan') AND v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'evidence_url_required');
  END IF;
  IF _result = 'insufficient_evidence' AND v_url IS NULL
     AND _evidence_confidence <> 'no_source' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'evidence_url_required');
  END IF;

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

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL OR COALESCE(p.verification_status,'') <> 'verified' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'place_not_published');
  END IF;

  -- Public action shape. 'restore_and_reactivate' exists so a place whose
  -- classification was previously revoked can come back after a fresh,
  -- fully-evidenced confirmation. Reactivation is never automatic.
  v_action := coalesce(nullif(btrim(coalesce(_public_action,'')), ''), 'none');
  IF _result = 'confirmed_fully_vegan' THEN
    IF v_action NOT IN ('none','restore_and_reactivate') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_public_action');
    END IF;
    IF v_action = 'restore_and_reactivate'
       AND COALESCE(p.veggie_classification,'') <> 'not_confirmed_fully_vegan' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_public_action');
    END IF;
    IF v_action = 'restore_and_reactivate'
       AND COALESCE(p.maintenance_status,'operational') <> 'operational' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'place_not_operational');
    END IF;
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

  SELECT * INTO r FROM public.community_place_vegan_reviews
   WHERE community_place_id = _place_id AND status = 'in_progress'
   FOR UPDATE LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_review');
  END IF;

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

  -- Restoration: a fully-evidenced confirmation on a previously revoked place
  -- returns the 100% Vegan classification. Visibility still requires the
  -- explicit, confirmed restore_and_reactivate action below.
  IF _result = 'confirmed_fully_vegan'
     AND COALESCE(p.veggie_classification,'') = 'not_confirmed_fully_vegan' THEN
    new_class := 'fully_vegan';
    hist_action := 'vegan_status_restored';
    UPDATE public.community_places
       SET veggie_classification = new_class, updated_at = now()
     WHERE id = _place_id;
    applied := true;
  END IF;

  IF _result = 'confirmed_fully_vegan' THEN
    UPDATE public.community_places
       SET last_reverified_at = now(), updated_at = now()
     WHERE id = _place_id;
    freshness_updated := true;
  END IF;

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

  IF v_action IN ('deactivate','revoke_and_deactivate') THEN
    PERFORM public.set_community_place_active(
      _place_id, false,
      CASE WHEN _result = 'no_longer_fully_vegan'
        THEN 'Vegan review: 100% vegan status revoked — hidden from Community Places discovery.'
        ELSE 'Vegan review: current 100% vegan evidence could not be confirmed — temporarily hidden.'
      END);
    applied := true;
  ELSIF v_action = 'restore_and_reactivate' THEN
    PERFORM public.set_community_place_active(
      _place_id, true,
      'Vegan review: 100% vegan status reconfirmed from a current first-party source — restored to discovery.');
    applied := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'review_id', r.id,
    'result', _result,
    'public_action', v_action,
    'public_action_applied', (v_action <> 'none'),
    'classification', new_class,
    'restored', (hist_action = 'vegan_status_restored'),
    'freshness_updated', freshness_updated,
    'needs_action', (_result <> 'confirmed_fully_vegan')
  );
END; $function$;

REVOKE ALL ON FUNCTION public.complete_community_place_vegan_review(uuid,text,text,text,text,text[],text[],text[],text,text,boolean,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_community_place_vegan_review(uuid,text,text,text,text,text[],text[],text[],text,text,boolean,uuid,uuid) TO authenticated;