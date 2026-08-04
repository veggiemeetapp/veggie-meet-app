CREATE OR REPLACE FUNCTION public.set_community_place_active(
  _place_id uuid,
  _active boolean,
  _note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- Only published, verified Community Places can have visibility toggled.
  IF COALESCE(p.verification_status, '') <> 'verified' THEN
    RAISE EXCEPTION 'Only published Community Places can change visibility.';
  END IF;

  -- Reactivation is only valid for operational places; closures stay hidden.
  IF _active AND COALESCE(p.maintenance_status, 'operational') <> 'operational' THEN
    RAISE EXCEPTION 'Only operational places can be made visible.';
  END IF;

  IF p.is_active = _active THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'place_id', _place_id,
                              'is_active', p.is_active,
                              'maintenance_status', p.maintenance_status);
  END IF;

  UPDATE public.community_places
     SET is_active = _active,
         updated_at = now()
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

REVOKE ALL ON FUNCTION public.set_community_place_active(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_community_place_active(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_community_place_active(uuid, boolean, text) TO authenticated;