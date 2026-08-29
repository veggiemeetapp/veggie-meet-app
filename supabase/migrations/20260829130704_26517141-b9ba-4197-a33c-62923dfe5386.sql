REVOKE ALL ON TABLE public.dm_conversation_clears FROM anon;
REVOKE ALL ON TABLE public.dm_conversation_clears FROM authenticated;
GRANT SELECT ON TABLE public.dm_conversation_clears TO authenticated;
GRANT ALL ON TABLE public.dm_conversation_clears TO service_role;