-- ============================================================================
-- WO-056 — Community Place reverification and data freshness.
--
-- Owner-only review workflow. Public place state is NEVER changed implicitly:
-- freshness is derived from existing verification dates, and closures are only
-- applied by explicitly delegating to the WO-053 maintenance RPC.
-- ============================================================================

CREATE TABLE public.community_place_reverifications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_place_id      uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  status                  text NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress','completed','cancelled')),
  started_by              uuid REFERENCES public.profiles(id),
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_by            uuid REFERENCES public.profiles(id),
  completed_at            timestamptz,
  result                  text
                            CHECK (result IS NULL OR result IN (
                              'confirmed_current','needs_place_update','needs_vegan_review',
                              'temporarily_closed','permanently_closed','duplicate_or_moved',
                              'insufficient_evidence')),
  owner_note              text,
  official_source_url     text,
  google_status_observed  text
                            CHECK (google_status_observed IS NULL OR google_status_observed IN
                              ('matches','name_mismatch','address_mismatch','moved',
                               'temporarily_closed','permanently_closed','not_found','unclear')),
  vegan_status_observed   text
                            CHECK (vegan_status_observed IS NULL OR vegan_status_observed IN
                              ('confirmed_fully_vegan','unclear','not_fully_vegan','no_source')),
  details_status_observed text
                            CHECK (details_status_observed IS NULL OR details_status_observed IN
                              ('accurate','needs_update','unclear')),
  place_action_applied    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Only the definer RPCs and admin code ever touch this table. No grant to
-- anon or authenticated: members must never read owner review notes.
GRANT ALL ON public.community_place_reverifications TO service_role;

ALTER TABLE public.community_place_reverifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read reverification audit"
  ON public.community_place_reverifications
  FOR SELECT TO authenticated
  USING (public.is_owner());

-- At most one open review per place.
CREATE UNIQUE INDEX community_place_reverifications_one_open
  ON public.community_place_reverifications (community_place_id)
  WHERE status = 'in_progress';

CREATE INDEX community_place_reverifications_place_idx
  ON public.community_place_reverifications (community_place_id, created_at DESC);

CREATE TRIGGER community_place_reverifications_updated_at
  BEFORE UPDATE ON public.community_place_reverifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Freshness derivation. Uses ONLY existing verification dates; nothing stored.
--   current   : baseline < 150 days old
--   due_soon   : 150–180 days old
--   due        : > 180 days old
--   never_reverified : last_reverified_at is null (verified_at is the baseline)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_freshness_label(
  _verified_at timestamptz,
  _last_reverified_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
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

REVOKE ALL ON FUNCTION public.place_freshness_label(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_freshness_label(timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Owner reverification queue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_place_reverification_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE items jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sort_key, t.baseline_at ASC NULLS FIRST), '[]'::jsonb)
    INTO items
  FROM (
    SELECT p.id,
           p.name,
           p.neighborhood,
           p.category::text                       AS category,
           COALESCE(p.maintenance_status,'operational') AS maintenance_status,
           p.is_active,
           p.verification_status,
           p.veggie_classification,
           p.verified_at,
           p.last_reverified_at,
           (p.google_place_id IS NOT NULL)        AS has_google_place_id,
           COALESCE(p.last_reverified_at, p.verified_at) AS baseline_at,
           CASE
             WHEN open_r.id IS NOT NULL THEN 'under_review'
             WHEN needs.id IS NOT NULL THEN 'needs_action'
             ELSE public.place_freshness_label(p.verified_at, p.last_reverified_at)
           END                                    AS reverification_state,
           public.place_freshness_label(p.verified_at, p.last_reverified_at) AS freshness,
           open_r.id                              AS open_review_id,
           open_r.started_at                      AS open_review_started_at,
           needs.result                           AS needs_action_result,
           needs.completed_at                     AS needs_action_at,
           (SELECT count(*)::int FROM public.community_place_reports rp
             WHERE rp.community_place_id = p.id
               AND rp.status IN ('pending','under_review')) AS open_reports_count,
           CASE
             WHEN needs.id IS NOT NULL   THEN 0
             WHEN open_r.id IS NOT NULL  THEN 1
             ELSE CASE public.place_freshness_label(p.verified_at, p.last_reverified_at)
                    WHEN 'due' THEN 2 WHEN 'due_soon' THEN 3
                    WHEN 'never_reverified' THEN 4 ELSE 5 END
           END                                    AS sort_key
      FROM public.community_places p
      LEFT JOIN LATERAL (
        SELECT r.id, r.started_at
          FROM public.community_place_reverifications r
         WHERE r.community_place_id = p.id AND r.status = 'in_progress'
         LIMIT 1
      ) open_r ON true
      LEFT JOIN LATERAL (
        SELECT r.id, r.result, r.completed_at
          FROM public.community_place_reverifications r
         WHERE r.community_place_id = p.id AND r.status = 'completed'
         ORDER BY r.completed_at DESC
         LIMIT 1
      ) needs ON needs.result IS DISTINCT FROM 'confirmed_current'
     WHERE p.verification_status = 'verified'
  ) t;

  RETURN jsonb_build_object('places', items);
END; $$;

REVOKE ALL ON FUNCTION public.get_place_reverification_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_place_reverification_queue() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Owner reverification workspace: public record + open review + safe report
-- summary. Reporter identity is not returned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_place_reverification_workspace(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE place jsonb; review jsonb; reports jsonb; history jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  SELECT to_jsonb(t) INTO place FROM (
    SELECT p.id, p.name, p.address, p.latitude, p.longitude,
           p.category::text AS category, p.neighborhood,
           p.google_place_id, p.google_maps_url, p.website_url,
           p.business_status, p.is_active,
           COALESCE(p.maintenance_status,'operational') AS maintenance_status,
           p.verification_status, p.veggie_classification,
           p.verified_at, p.last_reverified_at,
           public.place_freshness_label(p.verified_at, p.last_reverified_at) AS freshness
      FROM public.community_places p
     WHERE p.id = _place_id AND p.verification_status = 'verified'
  ) t;

  IF place IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;

  SELECT to_jsonb(r) INTO review
    FROM public.community_place_reverifications r
   WHERE r.community_place_id = _place_id AND r.status = 'in_progress'
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', rp.id,
           'reason_code', rp.reason_code,
           'explanation', rp.explanation,
           'official_source_url', rp.official_source_url,
           'status', rp.status,
           'created_at', rp.created_at
         ) ORDER BY rp.created_at ASC), '[]'::jsonb)
    INTO reports
    FROM public.community_place_reports rp
   WHERE rp.community_place_id = _place_id
     AND rp.status IN ('pending','under_review');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'status', r.status, 'result', r.result,
           'started_at', r.started_at, 'completed_at', r.completed_at,
           'owner_note', r.owner_note, 'official_source_url', r.official_source_url,
           'google_status_observed', r.google_status_observed,
           'vegan_status_observed', r.vegan_status_observed,
           'details_status_observed', r.details_status_observed,
           'place_action_applied', r.place_action_applied
         ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO history
    FROM public.community_place_reverifications r
   WHERE r.community_place_id = _place_id AND r.status <> 'in_progress';

  RETURN jsonb_build_object(
    'place', place,
    'open_review', review,
    'open_reports', reports,
    'history', history
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_place_reverification_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_place_reverification_workspace(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Start reverification. Idempotent: an existing open review is returned.
-- Touches no public place field.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_place_reverification(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; p RECORD; existing RECORD; new_id uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT id, verification_status INTO p
    FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;
  IF COALESCE(p.verification_status,'') <> 'verified' THEN
    RAISE EXCEPTION 'Only published Community Places can be reverified.';
  END IF;

  SELECT * INTO existing FROM public.community_place_reverifications
   WHERE community_place_id = _place_id AND status = 'in_progress' LIMIT 1;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
                              'review_id', existing.id, 'place_id', _place_id);
  END IF;

  INSERT INTO public.community_place_reverifications (community_place_id, started_by)
  VALUES (_place_id, me)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
                            'review_id', new_id, 'place_id', _place_id);
END; $$;

REVOKE ALL ON FUNCTION public.start_place_reverification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_place_reverification(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cancel an open reverification. No public place change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_place_reverification(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid; r RECORD;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT * INTO r FROM public.community_place_reverifications
   WHERE community_place_id = _place_id AND status = 'in_progress' FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'place_id', _place_id);
  END IF;

  UPDATE public.community_place_reverifications
     SET status = 'cancelled', completed_by = me, completed_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
                            'review_id', r.id, 'place_id', _place_id);
END; $$;

REVOKE ALL ON FUNCTION public.cancel_place_reverification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_place_reverification(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Complete reverification.
--   confirmed_current -> refreshes last_reverified_at ONLY. verified_at,
--                        classification, is_active and maintenance_status are
--                        all preserved.
--   every other result -> place is untouched and the review is a needs-action
--                        flag, UNLESS the owner explicitly opts in to applying
--                        the WO-053 closure status in the same transaction.
-- Never deletes a place, never republishes, never edits public detail fields.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_place_reverification(
  _place_id uuid,
  _result text,
  _owner_note text,
  _official_source_url text DEFAULT NULL,
  _google_status_observed text DEFAULT NULL,
  _vegan_status_observed text DEFAULT NULL,
  _details_status_observed text DEFAULT NULL,
  _apply_place_action boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  me uuid; p RECORD; r RECORD;
  clean_note text; clean_url text;
  applied boolean := false;
  action_result jsonb := NULL;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  IF _result IS NULL OR _result NOT IN (
     'confirmed_current','needs_place_update','needs_vegan_review',
     'temporarily_closed','permanently_closed','duplicate_or_moved',
     'insufficient_evidence') THEN
    RAISE EXCEPTION 'Unknown reverification result.';
  END IF;

  clean_note := nullif(btrim(coalesce(_owner_note,'')), '');
  IF clean_note IS NULL THEN
    RAISE EXCEPTION 'An internal reverification note is required.';
  END IF;
  IF length(clean_note) > 1000 THEN
    RAISE EXCEPTION 'Internal note must be 1000 characters or fewer.';
  END IF;

  clean_url := nullif(btrim(coalesce(_official_source_url,'')), '');
  IF clean_url IS NOT NULL THEN
    IF length(clean_url) > 500 THEN
      RAISE EXCEPTION 'Evidence URL must be 500 characters or fewer.';
    END IF;
    IF clean_url !~* '^https?://[^\s]+\.[^\s]+' THEN
      RAISE EXCEPTION 'Evidence URL must be a valid http(s) link.';
    END IF;
  END IF;

  IF _result = 'confirmed_current' AND clean_url IS NULL THEN
    RAISE EXCEPTION 'Confirming a place as current requires a primary evidence source URL.';
  END IF;

  SELECT * INTO p FROM public.community_places WHERE id = _place_id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Place not found.';
  END IF;
  IF COALESCE(p.verification_status,'') <> 'verified' THEN
    RAISE EXCEPTION 'Only published Community Places can be reverified.';
  END IF;

  SELECT * INTO r FROM public.community_place_reverifications
   WHERE community_place_id = _place_id AND status = 'in_progress' FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Start a reverification for this place first.';
  END IF;

  -- Optional, explicitly opted-in public consequence. Same transaction as the
  -- audit record, so a failure rolls back both.
  IF _apply_place_action AND _result IN ('temporarily_closed','permanently_closed') THEN
    action_result := public.set_community_place_status(_place_id, _result, clean_note);
    applied := true;
  END IF;

  IF _result = 'confirmed_current' THEN
    -- Freshness only. verified_at / verified_by / classification / visibility
    -- / maintenance_status / google_place_id are all deliberately untouched.
    UPDATE public.community_places
       SET last_reverified_at = now(), updated_at = now()
     WHERE id = _place_id;
  END IF;

  UPDATE public.community_place_reverifications
     SET status = 'completed',
         result = _result,
         owner_note = clean_note,
         official_source_url = clean_url,
         google_status_observed = nullif(btrim(coalesce(_google_status_observed,'')),''),
         vegan_status_observed = nullif(btrim(coalesce(_vegan_status_observed,'')),''),
         details_status_observed = nullif(btrim(coalesce(_details_status_observed,'')),''),
         place_action_applied = applied,
         completed_by = me,
         completed_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true,
    'place_id', _place_id,
    'review_id', r.id,
    'result', _result,
    'needs_action', (_result <> 'confirmed_current'),
    'place_action_applied', applied,
    'place_action', action_result,
    'last_reverified_at', CASE WHEN _result = 'confirmed_current' THEN now() ELSE p.last_reverified_at END
  );
END; $$;

REVOKE ALL ON FUNCTION public.complete_place_reverification(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_place_reverification(uuid, text, text, text, text, text, text, boolean) TO authenticated, service_role;
