DELETE FROM public.analytics_events
WHERE event_name = 'my_plans_opened'
  AND created_at >= '2026-08-09 08:50:00+00';