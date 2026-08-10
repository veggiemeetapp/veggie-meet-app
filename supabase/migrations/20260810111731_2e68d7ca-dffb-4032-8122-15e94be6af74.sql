DO $mig$
DECLARE
  fn text;
  def text;
  newdef text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['get_my_meetup_summary','get_host_meetup_summary','submit_meetup_feedback']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn;

    IF def IS NULL THEN
      RAISE EXCEPTION 'function %s not found', fn;
    END IF;

    newdef := replace(
      def,
      '(m.date + COALESCE(m.end_time, m.start_time + INTERVAL ''2 hours''))',
      'public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone)'
    );

    IF newdef = def THEN
      RAISE EXCEPTION 'expected naive end-time expression not found in %', fn;
    END IF;

    EXECUTE newdef;
  END LOOP;
END
$mig$;

REVOKE EXECUTE ON FUNCTION public.get_my_meetup_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_host_meetup_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_meetup_feedback(uuid, meetup_feedback_rating, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_meetup_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_host_meetup_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_meetup_feedback(uuid, meetup_feedback_rating, text) TO authenticated;