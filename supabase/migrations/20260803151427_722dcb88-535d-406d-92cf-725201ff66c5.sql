ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'place_suggestion_under_review';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'place_suggestion_approved';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'place_suggestion_duplicate';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'place_suggestion_rejected';