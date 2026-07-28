DROP POLICY IF EXISTS rec_feedback_own_select ON public.recommendation_feedback;
DROP POLICY IF EXISTS rec_feedback_own_insert ON public.recommendation_feedback;
DROP POLICY IF EXISTS rec_feedback_own_delete ON public.recommendation_feedback;

CREATE POLICY rec_feedback_own_select ON public.recommendation_feedback
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE POLICY rec_feedback_own_insert ON public.recommendation_feedback
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());

CREATE POLICY rec_feedback_own_delete ON public.recommendation_feedback
  FOR DELETE TO authenticated
  USING (profile_id = public.current_profile_id());