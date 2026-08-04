-- WO-056 hardening.
-- 1. Freshness depends on now(); it must be STABLE, never IMMUTABLE, or the
--    planner may constant-fold a stale timestamp into cached plans.
CREATE OR REPLACE FUNCTION public.place_freshness_label(
  _verified_at timestamptz,
  _last_reverified_at timestamptz
) RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(_last_reverified_at, _verified_at) IS NULL THEN 'due'
    WHEN now() - COALESCE(_last_reverified_at, _verified_at) > INTERVAL '180 days' THEN 'due'
    WHEN now() - COALESCE(_last_reverified_at, _verified_at) >= INTERVAL '150 days' THEN 'due_soon'
    WHEN _last_reverified_at IS NULL THEN 'never_reverified'
    ELSE 'current'
  END
$$;

-- 2. Anonymous execution is never permitted on owner surfaces. The platform
--    re-grants anon by default on new functions, so revoke explicitly.
REVOKE ALL ON FUNCTION public.place_freshness_label(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_place_reverification_queue() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_place_reverification_workspace(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_place_reverification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_place_reverification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_place_reverification(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;

-- place_freshness_label is an internal helper: signed-in users never call it.
GRANT EXECUTE ON FUNCTION public.place_freshness_label(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_place_reverification_queue() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_place_reverification_workspace(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_place_reverification(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_place_reverification(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_place_reverification(uuid, text, text, text, text, text, text, boolean) TO authenticated, service_role;
