
CREATE TYPE public.meetup_category AS ENUM
  ('dinner','brunch','coffee','picnic','cooking','walk','workshop','other');
CREATE TYPE public.meetup_status AS ENUM
  ('upcoming','full','in_progress','past','cancelled');
CREATE TYPE public.place_category AS ENUM
  ('restaurant','cafe','park','market','studio','venue');
CREATE TYPE public.attendance_status AS ENUM
  ('joined','checked_in','attended','cancelled');
CREATE TYPE public.friendship_status AS ENUM
  ('connected','pending','blocked');
CREATE TYPE public.message_type AS ENUM ('user','system');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  current_city TEXT,
  interests TEXT[] NOT NULL DEFAULT '{}',
  is_active_host BOOLEAN NOT NULL DEFAULT false,
  meetups_hosted_count INT NOT NULL DEFAULT 0,
  meetups_attended_count INT NOT NULL DEFAULT 0,
  veggies_met_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = auth_user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE TABLE public.community_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category public.place_category NOT NULL DEFAULT 'venue',
  address TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  upcoming_meetups_count INT NOT NULL DEFAULT 0,
  meetups_this_month INT NOT NULL DEFAULT 0,
  veggies_visited_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.community_places TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_places TO authenticated;
GRANT ALL ON public.community_places TO service_role;
ALTER TABLE public.community_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Places are viewable by everyone" ON public.community_places FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add places" ON public.community_places FOR INSERT TO authenticated WITH CHECK (true);
CREATE TRIGGER community_places_updated_at BEFORE UPDATE ON public.community_places FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.meetups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category public.meetup_category NOT NULL DEFAULT 'other',
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_place_id UUID REFERENCES public.community_places(id) ON DELETE SET NULL,
  custom_location_name TEXT,
  custom_location_address TEXT,
  cover_image_url TEXT,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INT NOT NULL DEFAULT 10,
  status public.meetup_status NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meetups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetups TO authenticated;
GRANT ALL ON public.meetups TO service_role;
ALTER TABLE public.meetups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Meetups are viewable by everyone" ON public.meetups FOR SELECT USING (true);
CREATE POLICY "Authenticated users can host meetups" ON public.meetups FOR INSERT TO authenticated WITH CHECK (host_id = public.current_profile_id());
CREATE POLICY "Hosts can update their meetups" ON public.meetups FOR UPDATE TO authenticated USING (host_id = public.current_profile_id()) WITH CHECK (host_id = public.current_profile_id());
CREATE POLICY "Hosts can delete their meetups" ON public.meetups FOR DELETE TO authenticated USING (host_id = public.current_profile_id());
CREATE TRIGGER meetups_updated_at BEFORE UPDATE ON public.meetups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id UUID NOT NULL UNIQUE REFERENCES public.meetups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO authenticated;
GRANT ALL ON public.chats TO service_role;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER chats_updated_at BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, profile_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_participants TO authenticated;
GRANT ALL ON public.chat_participants TO service_role;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_chat_participant(_chat_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_participants cp
    JOIN public.profiles p ON p.id = cp.profile_id
    WHERE cp.chat_id = _chat_id AND p.auth_user_id = auth.uid()
  );
$$;

CREATE POLICY "Participants can read their chats" ON public.chats FOR SELECT TO authenticated USING (public.is_chat_participant(id));
CREATE POLICY "Participants can read chat rosters" ON public.chat_participants FOR SELECT TO authenticated USING (public.is_chat_participant(chat_id));
CREATE POLICY "Users can join chats as themselves" ON public.chat_participants FOR INSERT TO authenticated WITH CHECK (profile_id = public.current_profile_id());

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  type public.message_type NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants can read messages" ON public.messages FOR SELECT TO authenticated USING (public.is_chat_participant(chat_id));
CREATE POLICY "Participants can send user messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (public.is_chat_participant(chat_id) AND type = 'user' AND sender_id = public.current_profile_id());

CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meetup_id UUID NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  status public.attendance_status NOT NULL DEFAULT 'joined',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, meetup_id)
);
GRANT SELECT ON public.attendance TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Attendance is viewable by everyone" ON public.attendance FOR SELECT USING (true);
CREATE POLICY "Users can create their own attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK (profile_id = public.current_profile_id());
CREATE POLICY "Users can update their own attendance" ON public.attendance FOR UPDATE TO authenticated USING (profile_id = public.current_profile_id()) WITH CHECK (profile_id = public.current_profile_id());
CREATE TRIGGER attendance_updated_at BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_a_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_b_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_meetup_id UUID REFERENCES public.meetups(id) ON DELETE SET NULL,
  friends_since DATE,
  meetups_together_count INT NOT NULL DEFAULT 0,
  status public.friendship_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_a_id, profile_b_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Friends can view their own friendships" ON public.friendships FOR SELECT TO authenticated
  USING (profile_a_id = public.current_profile_id() OR profile_b_id = public.current_profile_id());
CREATE POLICY "Users can create friendships they're part of" ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (profile_a_id = public.current_profile_id() OR profile_b_id = public.current_profile_id());
CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_meetup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_chat_id UUID; host_name TEXT;
BEGIN
  INSERT INTO public.chats (meetup_id) VALUES (NEW.id) RETURNING id INTO new_chat_id;
  INSERT INTO public.chat_participants (chat_id, profile_id) VALUES (new_chat_id, NEW.host_id) ON CONFLICT DO NOTHING;
  SELECT display_name INTO host_name FROM public.profiles WHERE id = NEW.host_id;
  INSERT INTO public.messages (chat_id, sender_id, body, type)
  VALUES (new_chat_id, NULL, COALESCE(NULLIF(host_name,''),'Host') || ' created this meetup.', 'system');
  INSERT INTO public.attendance (profile_id, meetup_id, status) VALUES (NEW.host_id, NEW.id, 'joined') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_meetup_created AFTER INSERT ON public.meetups FOR EACH ROW EXECUTE FUNCTION public.handle_new_meetup();

CREATE OR REPLACE FUNCTION public.handle_new_attendance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_chat_id UUID; joiner_name TEXT; is_host BOOLEAN;
BEGIN
  SELECT id INTO target_chat_id FROM public.chats WHERE meetup_id = NEW.meetup_id;
  IF target_chat_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.chat_participants (chat_id, profile_id) VALUES (target_chat_id, NEW.profile_id) ON CONFLICT DO NOTHING;
  SELECT (host_id = NEW.profile_id) INTO is_host FROM public.meetups WHERE id = NEW.meetup_id;
  IF is_host IS DISTINCT FROM TRUE THEN
    SELECT display_name INTO joiner_name FROM public.profiles WHERE id = NEW.profile_id;
    INSERT INTO public.messages (chat_id, sender_id, body, type)
    VALUES (target_chat_id, NULL, COALESCE(NULLIF(joiner_name,''),'Someone') || ' joined the meetup.', 'system');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_attendance_created AFTER INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.handle_new_attendance();
