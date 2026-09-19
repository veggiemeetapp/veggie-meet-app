-- WO-154: private, gated member-facing Map access.
CREATE TABLE public.map_access_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id)
);

GRANT SELECT ON public.map_access_grants TO authenticated;
GRANT ALL ON public.map_access_grants TO service_role;

ALTER TABLE public.map_access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can see only their own map grant"
  ON public.map_access_grants FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_owner());

CREATE POLICY "Owner manages map grants"
  ON public.map_access_grants FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE OR REPLACE FUNCTION public.has_map_access()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (
       public.is_owner()
       OR EXISTS (
         SELECT 1 FROM public.map_access_grants g WHERE g.auth_user_id = auth.uid()
       )
     );
$function$;

REVOKE ALL ON FUNCTION public.has_map_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_map_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_map_access() TO service_role;