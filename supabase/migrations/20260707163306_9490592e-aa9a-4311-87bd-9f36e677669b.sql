ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
-- Mark existing profiles as onboarded if they have completed their essential info
UPDATE public.profiles SET onboarding_completed = TRUE
WHERE current_city IS NOT NULL
  AND display_name IS NOT NULL AND display_name <> ''
  AND array_length(interests, 1) IS NOT NULL AND array_length(interests, 1) > 0;