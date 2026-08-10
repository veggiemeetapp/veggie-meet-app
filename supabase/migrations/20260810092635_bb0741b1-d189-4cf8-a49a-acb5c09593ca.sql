REVOKE ALL ON FUNCTION public.submit_beta_feedback(text,text,text,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_beta_feedback_queue(text,int,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_beta_feedback_status(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_private_beta_health() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_beta_operational_failures(int,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_private_beta_integrity_health() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anonymize_beta_feedback_on_profile_delete() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_beta_feedback(text,text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_beta_feedback_queue(text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_beta_feedback_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_beta_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_beta_operational_failures(int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_beta_integrity_health() TO authenticated;