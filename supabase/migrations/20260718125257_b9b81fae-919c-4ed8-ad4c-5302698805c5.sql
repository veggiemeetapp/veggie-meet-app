
CREATE POLICY "Signed-in users can view place check-ins"
ON public.place_check_ins FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Signed-in users can view established friendships"
ON public.friendships FOR SELECT TO authenticated
USING (status IN ('connected','verified'));
