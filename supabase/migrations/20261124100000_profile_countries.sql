-- 2026-11-24 — Countries visited ("n/195 countries" on the profile).
--
-- Additive only. One new table plus two RPCs; no existing object changes.
-- The list is member-entered (honour based, like NomadTable), never derived
-- from check-ins, so it does not touch Community Impact or the Collection.

CREATE TABLE IF NOT EXISTS public.profile_countries (
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, country_code)
);
ALTER TABLE public.profile_countries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_countries FROM PUBLIC, anon, authenticated;
-- No policies on purpose: all access goes through the SECURITY DEFINER RPCs below.

-- Countries for a profile. Own list always; another member's only when that
-- member is live, onboarded and not blocked either way (same gate as
-- get_public_collection).
CREATE OR REPLACE FUNCTION public.get_profile_countries(_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  target record;
  codes text[];
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _profile_id IS NULL THEN RAISE EXCEPTION 'profile required'; END IF;

  IF me <> _profile_id THEN
    SELECT id, deleted_at, onboarding_completed INTO target
      FROM public.profiles WHERE id = _profile_id;
    IF NOT FOUND OR target.deleted_at IS NOT NULL OR target.onboarding_completed IS NOT TRUE
       OR public.is_blocked_between(me, _profile_id) THEN
      RETURN jsonb_build_object('available', false, 'profile_id', _profile_id, 'codes', '[]'::jsonb);
    END IF;
  END IF;

  SELECT COALESCE(array_agg(country_code ORDER BY added_at, country_code), '{}')
    INTO codes
    FROM public.profile_countries WHERE profile_id = _profile_id;

  RETURN jsonb_build_object('available', true, 'profile_id', _profile_id, 'codes', to_jsonb(codes));
END; $$;
REVOKE ALL ON FUNCTION public.get_profile_countries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_countries(uuid) TO authenticated;

-- Replace the caller's list with _codes. Codes already present keep their
-- added_at (so the order stays stable); the rest are inserted or removed.
CREATE OR REPLACE FUNCTION public.set_my_countries(_codes text[])
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  clean text[];
  codes text[];
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COALESCE(array_agg(DISTINCT upper(c)), '{}') INTO clean
    FROM unnest(COALESCE(_codes, '{}')) AS c
   WHERE c IS NOT NULL;
  IF EXISTS (SELECT 1 FROM unnest(clean) AS c WHERE c !~ '^[A-Z]{2}$') THEN
    RAISE EXCEPTION 'Invalid country code';
  END IF;
  IF cardinality(clean) > 250 THEN
    RAISE EXCEPTION 'Too many countries';
  END IF;

  DELETE FROM public.profile_countries
   WHERE profile_id = me AND NOT (country_code = ANY (clean));
  INSERT INTO public.profile_countries (profile_id, country_code)
  SELECT me, c FROM unnest(clean) AS c
  ON CONFLICT (profile_id, country_code) DO NOTHING;

  SELECT COALESCE(array_agg(country_code ORDER BY added_at, country_code), '{}')
    INTO codes
    FROM public.profile_countries WHERE profile_id = me;

  RETURN jsonb_build_object('available', true, 'profile_id', me, 'codes', to_jsonb(codes));
END; $$;
REVOKE ALL ON FUNCTION public.set_my_countries(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_countries(text[]) TO authenticated;
