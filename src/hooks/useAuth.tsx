import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearStoredPermissions } from "@/lib/permissions";
import { resetAnalyticsIdentity } from "@/lib/analytics";


export type Profile = {
  id: string;
  auth_user_id: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  current_city: string | null;
  home_city_id: string | null;
  interests: string[];
  is_active_host: boolean;
  onboarding_completed: boolean;
  dietary_identity: string | null;
  community_guidelines_accepted_at: string | null;
};

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  // Track the previously observed auth user id so we can wipe React Query
  // caches on sign-out or same-device account switches. Without this the next
  // user briefly sees the previous user's Today/Plans/DM/Notification data.
  const lastUserIdRef = useRef<string | null>(null);
  // WO-086 DEF-086-05: `onAuthStateChange` (INITIAL_SESSION) and `getSession`
  // both resolve on boot, and each used to fire its own `get_my_profile`.
  // Coalesce concurrent loads per auth user so one boot = one profile call.
  const profileFetchRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);

  async function loadProfile(userId: string | undefined, force = false) {
    if (!userId) {
      profileFetchRef.current = null;
      loadedUserIdRef.current = null;
      setProfile(null);
      return;
    }
    const inFlight = profileFetchRef.current;
    if (!force && inFlight && inFlight.userId === userId) return inFlight.promise;
    const promise = (async () => {
      // Uses the get_my_profile() RPC (SECURITY DEFINER) so callers don't need
      // direct SELECT on profiles.auth_user_id — that column is now hidden from
      // arbitrary authenticated users at the table-privilege level.
      const { data } = await supabase.rpc("get_my_profile");
      setProfile((data as Profile) ?? null);
      loadedUserIdRef.current = userId;
    })().finally(() => {
      if (profileFetchRef.current?.promise === promise) profileFetchRef.current = null;
    });
    profileFetchRef.current = { userId, promise };
    return promise;
  }

  useEffect(() => {
    // Register listener first, then hydrate
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      const nextId = s?.user?.id ?? null;
      if (lastUserIdRef.current !== null && lastUserIdRef.current !== nextId) {
        // User changed (sign-out, account switch, expired/revoked/deleted).
        // Drop all cached queries so the next identity never sees them.
        qc.clear();
        setProfile(null);
        profileFetchRef.current = null;
        loadedUserIdRef.current = null;
        // WO-084: drop analytics view-dedupe state so member B's activity can
        // never be suppressed or attributed via member A's client state.
        resetAnalyticsIdentity();
      }
      lastUserIdRef.current = nextId;
      setSession(s);
      // Defer profile fetch to avoid deadlock. Token refreshes for the same
      // identity keep the already-loaded profile instead of refetching it.
      setTimeout(() => {
        if (nextId && loadedUserIdRef.current === nextId) return;
        loadProfile(s?.user.id);
      }, 0);
    });

    supabase.auth.getSession().then(({ data }) => {
      lastUserIdRef.current = data.session?.user?.id ?? null;
      setSession(data.session);
      loadProfile(data.session?.user.id).finally(() => setLoading(false));
    });

    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    refreshProfile: async () => {
      await loadProfile(session?.user.id, true);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      // Belt-and-suspenders: also clear here in case the auth listener races
      // navigation to a signed-out screen.
      qc.clear();
      setProfile(null);
      // WO-073: drop any pending post-auth deep-link hint so the next identity
      // on this tab never resumes into the previous member's destination.
      try {
        sessionStorage.removeItem("veggiemeet_post_auth_next");
      } catch {
        /* ignore */
      }
      // WO-078: clear identity-scoped location/notification permission state so
      // the next member on this device starts from a recomputed location state.
      clearStoredPermissions();
      // WO-084: reset client analytics state on explicit sign-out too.
      resetAnalyticsIdentity();


      // (legacy `veggiemeet_onboarded` localStorage flag removed — route
      // gating derives onboarding state from the server profile only.)
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
