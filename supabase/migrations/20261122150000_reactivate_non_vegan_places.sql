-- 2026-11-22 (e) — Owner can re-show a hidden vegetarian / vegan-options place.
--
-- set_community_place_active still refused to make a place visible unless it
-- was 'fully_vegan' (WO-058, vegan-only era). Since Community Places now carry
-- the full classification vocabulary, only a vegan-review downgrade
-- ('not_confirmed_fully_vegan') blocks re-activation. Otherwise identical to
-- 20260804115144_d814feb6-ce0e-4739-9574-fea43df53297.sql.

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
  -- 2026-11-22: visibility is blocked only after a vegan review downgraded the
  -- place; vegetarian / vegan-options classifications are valid, visible places.
  IF _active AND p.veggie_classification = 'not_confirmed_fully_vegan' THEN
    RAISE EXCEPTION 'This place can only become visible again once its veggie classification is reconfirmed through Review vegan status.';
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

