-- WO-064 — Production database privilege hardening.
-- Phase 1: remove dangerous privileges (TRUNCATE / REFERENCES / TRIGGER / MAINTAIN)
-- from every normal application role on every public application table.
DO $$
DECLARE t regclass;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON %s FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- Phase 2: private owner allowlist — no normal-role access at all.
REVOKE ALL ON public.owner_allowlist FROM PUBLIC, anon, authenticated;

-- Phase 3: tables written only by trusted SECURITY DEFINER RPCs -> read-only for members.
REVOKE INSERT, UPDATE, DELETE ON public.account_deletion_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.check_in_requests        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_feedback          FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_follow_up_state   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_invitations       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_location_changes  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_qr_tokens         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_reports           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meetup_update_seen       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_preferences FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profile_onboarding_state FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profile_preferences      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.recommendation_feedback  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.safety_reports           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_blocks              FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_reports             FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.verified_meetup_connections FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_place_suggestions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cities                   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.interest_catalogue       FROM anon, authenticated;

-- Phase 4: narrow the remaining member-writable tables to the exact operations
-- the client actually performs.
REVOKE DELETE ON public.profiles           FROM anon, authenticated; -- deletion via RPC only
REVOKE INSERT, DELETE ON public.notifications FROM anon, authenticated; -- mark-read UPDATE only
REVOKE INSERT, UPDATE, DELETE ON public.chats FROM anon, authenticated;
REVOKE DELETE ON public.chat_participants  FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.messages   FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.dm_conversations FROM anon, authenticated;
REVOKE DELETE ON public.dm_messages        FROM anon, authenticated;
REVOKE DELETE ON public.place_candidates   FROM anon, authenticated;
REVOKE SELECT, UPDATE, DELETE ON public.analytics_events FROM anon, authenticated; -- write-only event sink

-- Phase 5: no anon DML anywhere; anon keeps only the intended public reads.
DO $$
DECLARE t regclass;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %s FROM anon', t);
  END LOOP;
END $$;

-- Phase 6: future-safe default privileges — new tables must not inherit
-- TRUNCATE / REFERENCES / TRIGGER / MAINTAIN for normal application roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
