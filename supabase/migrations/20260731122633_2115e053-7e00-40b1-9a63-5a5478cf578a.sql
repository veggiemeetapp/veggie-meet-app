DROP TRIGGER IF EXISTS trg_handle_new_user ON auth.users;
CREATE TRIGGER trg_handle_new_user
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: accounts created while the trigger was absent have no profile.
INSERT INTO public.profiles (auth_user_id, display_name, bio)
SELECT u.id, COALESCE(NULLIF(u.raw_user_meta_data->>'display_name',''), split_part(u.email,'@',1)), ''
FROM auth.users u
LEFT JOIN public.profiles p ON p.auth_user_id = u.id
WHERE p.id IS NULL;

INSERT INTO public.profile_preferences (profile_id)
SELECT p.id FROM public.profiles p
LEFT JOIN public.profile_preferences pp ON pp.profile_id = p.id
WHERE pp.profile_id IS NULL;

INSERT INTO public.notification_preferences (profile_id)
SELECT p.id FROM public.profiles p
LEFT JOIN public.notification_preferences np ON np.profile_id = p.id
WHERE np.profile_id IS NULL;