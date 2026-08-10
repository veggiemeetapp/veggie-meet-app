DELETE FROM public.beta_feedback
WHERE message IN (
  'WO-089A temporary beta feedback verification.',
  'WO-089A retry-path verification item.'
);

DELETE FROM public.analytics_events
WHERE created_at >= '2026-08-10 09:40:20+00';