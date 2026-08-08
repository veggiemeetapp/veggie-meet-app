-- ============================================================
-- WO-072 — Member Profile Privacy & Edit Integrity
-- ============================================================

-- ---------- 1. Validation helpers ----------
CREATE OR REPLACE FUNCTION public.is_safe_avatar_url(_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _url IS NULL
     OR (
       _url ~* '^https://[a-z0-9._~%-]+(:[0-9]+)?/[^[:space:]]*$'
       AND length(_url) <= 2048
     );
$$;

CREATE OR REPLACE FUNCTION public.normalize_interests(_interests text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_clean text[];
  v_bad   text;
BEGIN
  IF _interests IS NULL THEN RETURN NULL; END IF;

  -- trim, drop empties, de-duplicate (stable order)
  SELECT array_agg(x ORDER BY ord) INTO v_clean
  FROM (
    SELECT DISTINCT ON (lower(btrim(t.v))) btrim(t.v) AS x, t.ord
    FROM unnest(_interests) WITH ORDINALITY AS t(v, ord)
    WHERE btrim(COALESCE(t.v, '')) <> ''
    ORDER BY lower(btrim(t.v)), t.ord
  ) s;

  IF v_clean IS NULL OR array_length(v_clean, 1) < 3 THEN
    RAISE EXCEPTION 'pick at least 3 interests' USING ERRCODE = '22023';
  END IF;
  IF array_length(v_clean, 1) > 8 THEN
    RAISE EXCEPTION 'pick at most 8 interests' USING ERRCODE = '22023';
  END IF;

  -- every value must exist in the approved catalogue (id or label)
  SELECT c INTO v_bad
  FROM unnest(v_clean) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.interest_catalogue ic
    WHERE ic.active AND (lower(ic.id) = lower(c) OR lower(ic.label) = lower(c))
  )
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unsupported interest: %', v_bad USING ERRCODE = '22023';
  END IF;

  RETURN v_clean;
END $$;

-- ---------- 2. Canonical profile edit RPC ----------
CREATE OR REPLACE FUNCTION public.update_my_profile(
  _display_name     text    DEFAULT NULL,
  _pronouns         text    DEFAULT NULL,
  _bio              text    DEFAULT NULL,
  _avatar_url       text    DEFAULT NULL,
  _clear_avatar     boolean DEFAULT false,
  _interests        text[]  DEFAULT NULL,
  _dietary_identity text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid       uuid := public.current_profile_id();
  v_name      text;
  v_bio       text;
  v_interests text[];
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _display_name IS NOT NULL THEN
    v_name := btrim(_display_name);
    IF length(v_name) = 0 THEN
      RAISE EXCEPTION 'display_name required' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) > 40 THEN
      RAISE EXCEPTION 'display_name too long (max 40)' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _bio IS NOT NULL THEN
    v_bio := btrim(regexp_replace(_bio, '[[:space:]]{4,}', '   ', 'g'));
    IF length(v_bio) > 300 THEN
      RAISE EXCEPTION 'bio too long (max 300)' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _avatar_url IS NOT NULL AND NOT public.is_safe_avatar_url(_avatar_url) THEN
    RAISE EXCEPTION 'avatar must be a hosted https image URL' USING ERRCODE = '22023';
  END IF;

  IF _interests IS NOT NULL THEN
    v_interests := public.normalize_interests(_interests);
  END IF;

  UPDATE public.profiles
     SET display_name      = COALESCE(v_name, display_name),
         pronouns          = CASE WHEN _pronouns IS NOT NULL
                                  THEN NULLIF(btrim(_pronouns), '') ELSE pronouns END,
         bio               = COALESCE(v_bio, bio),
         avatar_url        = CASE WHEN _clear_avatar THEN NULL
                                 ELSE COALESCE(_avatar_url, avatar_url) END,
         interests         = COALESCE(v_interests, interests),
         dietary_identity  = COALESCE(_dietary_identity, dietary_identity),
         updated_at        = now()
   WHERE id = v_pid;
END $$;

-- ---------- 3. Server-authoritative guidelines acknowledgement ----------
CREATE OR REPLACE FUNCTION public.accept_community_guidelines()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
  v_at  timestamptz;
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET community_guidelines_accepted_at = COALESCE(community_guidelines_accepted_at, now()),
         updated_at = now()
   WHERE id = v_pid
   RETURNING community_guidelines_accepted_at INTO v_at;
  RETURN v_at;
END $$;

-- ---------- 4. Harden existing settings RPC (avatar + interests) ----------
CREATE OR REPLACE FUNCTION public.update_profile_settings(
  _display_name text DEFAULT NULL,
  _dietary_identity text DEFAULT NULL,
  _pronouns text DEFAULT NULL,
  _bio text DEFAULT NULL,
  _avatar_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.update_my_profile(
    _display_name     => _display_name,
    _pronouns         => _pronouns,
    _bio              => _bio,
    _avatar_url       => NULLIF(_avatar_url, ''),
    _clear_avatar     => (_avatar_url = ''),
    _interests        => NULL,
    _dietary_identity => _dietary_identity
  );
END $$;

CREATE OR REPLACE FUNCTION public.update_discovery_settings(
  _home_city_id uuid DEFAULT NULL,
  _selected_city_id uuid DEFAULT NULL,
  _interests text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := public.current_profile_id();
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _interests IS NOT NULL THEN
    UPDATE public.profiles
       SET interests = public.normalize_interests(_interests),
           updated_at = now()
     WHERE id = v_pid;
  END IF;

  IF _home_city_id IS NOT NULL THEN
    PERFORM public.set_home_city(_home_city_id);
  END IF;

  IF _selected_city_id IS NOT NULL THEN
    PERFORM public.set_selected_city(_selected_city_id);
  END IF;
END $$;

-- ---------- 5. Block-aware, onboarding-aware profile visibility ----------
DROP POLICY IF EXISTS "Bounded profile visibility" ON public.profiles;
CREATE POLICY "Bounded profile visibility"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR (
    onboarding_completed
    AND NOT public.is_blocked_between(public.current_profile_id(), id)
    AND (
      discovery_visible
      OR public.are_connected(public.current_profile_id(), id)
      OR public.shares_context_with(id)
    )
  )
);

-- ---------- 6. No direct client INSERT/UPDATE on profiles ----------
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
REVOKE INSERT, UPDATE ON public.profiles FROM anon;

-- ---------- 7. Column-scoped SELECT: approved public fields only ----------
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, display_name, bio, avatar_url, current_city, interests,
  is_active_host, home_city_id, dietary_identity, pronouns,
  created_at, discovery_visible
) ON public.profiles TO authenticated;

-- onboarding/preferences: read-own only, mutations via SECDEF RPCs
DROP POLICY IF EXISTS "own onboarding state insert" ON public.profile_onboarding_state;
DROP POLICY IF EXISTS "own onboarding state update" ON public.profile_onboarding_state;
DROP POLICY IF EXISTS "Users insert their own preferences" ON public.profile_preferences;
DROP POLICY IF EXISTS "Users update their own preferences" ON public.profile_preferences;
REVOKE INSERT, UPDATE, DELETE ON public.profile_onboarding_state FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.profile_preferences FROM authenticated, anon;

-- ---------- 8. Execute grants ----------
REVOKE ALL ON FUNCTION public.update_my_profile(text,text,text,text,boolean,text[],text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_community_guidelines() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_interests(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_safe_avatar_url(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_profile_settings(text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_discovery_settings(uuid,uuid,text[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_my_profile(text,text,text,text,boolean,text[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_community_guidelines() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile_settings(text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_discovery_settings(uuid,uuid,text[]) TO authenticated;
