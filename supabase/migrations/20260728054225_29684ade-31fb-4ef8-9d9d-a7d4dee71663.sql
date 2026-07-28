-- 1. Drop leftover diagnostic tables (anon-readable public leak)
DROP TABLE IF EXISTS public._wo035_p2_diag CASCADE;
DROP TABLE IF EXISTS public._wo035_p2_diag2 CASCADE;
DROP TABLE IF EXISTS public._wo035_p2_forloop CASCADE;
DROP TABLE IF EXISTS public._wo035_p2_log CASCADE;
DROP TABLE IF EXISTS public._wo035_p2_manual CASCADE;
DROP TABLE IF EXISTS public._wo035_p2_notif_probe CASCADE;
DROP TABLE IF EXISTS public._wo035_p2_perform CASCADE;

-- 2. Tighten profiles SELECT policy: require authenticated
--    (Direct-table SELECT was open to `public`, exposing all rows including
--     auth_user_id and discovery_visible=false profiles to anonymous visitors.)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles readable by authenticated"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Revoke stray anon SELECT if it exists at the table-grant level
REVOKE SELECT ON public.profiles FROM anon;

-- 3. Pin search_path on the sole remaining user-owned function without one
ALTER FUNCTION public.to_plan(anyelement) SET search_path = public;