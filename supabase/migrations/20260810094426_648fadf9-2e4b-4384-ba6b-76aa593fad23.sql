REVOKE ALL ON TABLE public.beta_feedback FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.beta_feedback FROM authenticated;
GRANT SELECT ON TABLE public.beta_feedback TO authenticated;
GRANT ALL ON TABLE public.beta_feedback TO service_role;