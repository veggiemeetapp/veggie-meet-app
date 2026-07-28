
CREATE TABLE public.place_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_place_id text NOT NULL,
  checked_in_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX place_check_ins_unique_daily
  ON public.place_check_ins (profile_id, community_place_id, checked_in_on);

CREATE INDEX place_check_ins_profile_idx ON public.place_check_ins (profile_id);
CREATE INDEX place_check_ins_place_idx ON public.place_check_ins (community_place_id);

GRANT SELECT, INSERT ON public.place_check_ins TO authenticated;
GRANT ALL ON public.place_check_ins TO service_role;

ALTER TABLE public.place_check_ins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own place check-ins select"
  ON public.place_check_ins FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());

CREATE POLICY "own place check-ins insert"
  ON public.place_check_ins FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());
