DELETE FROM public.analytics_events
WHERE id IN (
  SELECT id FROM public.analytics_events
  ORDER BY created_at DESC
  LIMIT 1000 OFFSET 3
);