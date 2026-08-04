ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'community_place_report_under_review';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'community_place_report_resolved';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'community_place_report_dismissed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'community_place_report_duplicate';