DELETE FROM public.analytics_events
WHERE created_at >= '2026-08-10T04:12:00Z'
  AND created_at <= '2026-08-10T04:18:00Z'
  AND event_name IN ('you_opened','my_plans_opened','community_home_opened');