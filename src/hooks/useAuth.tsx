import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearStoredPermissions } from "@/lib/permissions";
import { resetAnalyticsIdentity } from "@/lib/analytics";
import { reconcileAccountMarker, removeProtectedQueries } from "@/lib/buildFreshness";
import {
  AUTH_HYDRATION_GRACE_MS,
  classifyAuthGate,
  hasPersistedAuthToken,
  OAUTH_CALLBACK_GRACE_MS,
  type AuthGate,
} from "@/lib/authHydration";
import { clearOAuthPending, hasPendingOAuth } from "@/lib/authRedirect";
import { classifyRestoration } from "@/lib/authRestorationOutcome";
import { noteAuthGate } from "@/lib/updateTelemetry";



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
  /**
   * WO-145Q — the only value route gates may branch on. `restoring` means
   * authentication is still being resolved (including a persisted session whose
   * refresh is still in flight after an update reload), so the signed-out
   * experience must not render.
   */
  authGate: AuthGate;
  refreshProfile: () => Promise<void>;
  /** WO-145Q — retry a delayed restoration without touching member data. */
  retryRestore: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  authGate: "restoring",
  refreshProfile: async () => {},
  retryRestore: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // WO-145Q — the profile fetch for the current session has settled (found or
  // provably absent). A session without a settled profile must never be routed
  // on: that is what redirected a fully onboarded member to onboarding.
  const [profileResolved, setProfileResolved] = useState(false);
  const [graceElapsed, setGraceElapsed] = useState(false);
  // WO-145Q CORRECTION — the profile read failed (offline / transient). Distinct
  // from "provably absent", which is a genuine new member.
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  // WO-145R — the persisted session was CONCLUSIVELY rejected or removed (an
  // expired/revoked refresh token, a real SIGNED_OUT event, or storage that no
  // longer holds a session). Settled negative results only: never set by a
  // timeout, an offline condition or a 5xx.
  const [sessionRejected, setSessionRejected] = useState(false);
  // WO-145Q CORRECTION — an explicit sign-out is the ONLY thing that makes the
  // signed-out experience correct for a device that held a session.
  const [explicitSignOut, setExplicitSignOut] = useState(false);
  // A fresh OAuth callback can briefly have neither an in-memory session nor a
  // persisted token. Remember that this absence is inconclusive so `/` cannot
  // bounce through the signed-out onboarding route while tokens are exchanged.
  const [oauthPending, setOAuthPending] = useState(() => hasPendingOAuth());

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
  /**
   * WO-145Q CORRECTION — this device holds a persisted session (presence only).
   * Computed synchronously on the very first render, so the gate can never see
   * "no persisted session" for a device that has one — that ordering is what
   * allowed the signed-out welcome screen to render during restoration.
   */
  const [persistedToken, setPersistedToken] = useState<boolean>(() => {
    try {
      return hasPersistedAuthToken(window.localStorage, window.sessionStorage);
    } catch {
      return false;
    }
  });


  async function loadProfile(userId: string | undefined, force = false) {
    if (!userId) {
      profileFetchRef.current = null;
      loadedUserIdRef.current = null;
      setProfile(null);
      setProfileResolved(false);
      return;
    }
    const inFlight = profileFetchRef.current;
    if (!force && inFlight && inFlight.userId === userId) return inFlight.promise;
    const promise = (async () => {
      // Uses the get_my_profile() RPC (SECURITY DEFINER) so callers don't need
      // direct SELECT on profiles.auth_user_id — that column is now hidden from
      // arbitrary authenticated users at the table-privilege level.
      const { data, error } = await supabase.rpc("get_my_profile");
      if (error) {
        // Unknown, not absent: keep the member on the restoration state.
        setProfileUnavailable(true);
        return;
      }
      setProfileUnavailable(false);
      setProfile((data as Profile) ?? null);
      loadedUserIdRef.current = userId;
    })().finally(() => {
      if (profileFetchRef.current?.promise === promise) profileFetchRef.current = null;
      // Settled either way: a failed read must not hold the member in a
      // permanent loading state.
      setProfileResolved(true);
    });
    profileFetchRef.current = { userId, promise };
    return promise;
  }

  /**
   * WO-145Q — bounded restore window. It runs only when this device actually
   * holds a persisted session token, so a genuinely signed-out visitor reaches
   * onboarding immediately.
   */
  useEffect(() => {
    let persisted = false;
    try {
      persisted = hasPersistedAuthToken(window.localStorage, window.sessionStorage);
    } catch {
      persisted = false;
    }
    setPersistedToken((prev) => prev || persisted);
    if (!persisted) {
      setGraceElapsed(true);
      return;
    }
    const t = window.setTimeout(() => setGraceElapsed(true), AUTH_HYDRATION_GRACE_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Bound the callback wait. A cancelled/abandoned provider flow must never
  // trap this tab on the restoration screen forever.
  useEffect(() => {
    if (!oauthPending) return;
    const t = window.setTimeout(() => {
      clearOAuthPending();
      setOAuthPending(false);
    }, OAUTH_CALLBACK_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [oauthPending]);


  useEffect(() => {
    // Register listener first, then hydrate
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
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
      // WO-145B: cross-document account partition marker. `qc.clear()` above
      // covers this document; the marker covers the case where a different
      // document (or a restored page) boots under a new account, and removes
      // the previous account's protected reads before any render.
      try {
        const outcome = reconcileAccountMarker(window.localStorage, nextId);
        if (outcome === "account-changed") removeProtectedQueries(qc);
      } catch {
        /* private mode: in-memory clear() above still guarantees isolation */
      }
      lastUserIdRef.current = nextId;
      setSession(s);
      /**
       * WO-145R — a real SIGNED_OUT event is the auth client telling us the
       * persisted session is conclusively gone (expired or revoked refresh
       * token, or a sign-out elsewhere). Clearing the persisted-session marker
       * here is what makes the normal signed-out experience reachable instead of
       * trapping the member on "Still restoring your session" forever. It never
       * touches member data. Any event that carries a session is conclusive the
       * other way, so the rejection flag is cleared.
       */
      if (evt === "SIGNED_OUT" && !s) {
        setPersistedToken(false);
        setSessionRejected(true);
        setGraceElapsed(true);
        setProfileResolved(false);
        setProfileUnavailable(false);
      } else if (s) {
        clearOAuthPending();
        setOAuthPending(false);
        setSessionRejected(false);
      }
      // Defer profile fetch to avoid deadlock. Token refreshes for the same
      // identity keep the already-loaded profile instead of refetching it.
      setTimeout(() => {
        if (nextId && loadedUserIdRef.current === nextId) return;
        loadProfile(s?.user.id);
      }, 0);
    });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        lastUserIdRef.current = data.session?.user?.id ?? null;
        setSession(data.session);
        // WO-145R — separate a conclusive rejection from an inconclusive failure.
        let stillPersisted = false;
        try {
          stillPersisted = hasPersistedAuthToken(window.localStorage, window.sessionStorage);
        } catch {
          stillPersisted = false;
        }
        const outcome = classifyRestoration({
          hasSession: !!data.session,
          error: error ?? null,
          persistedToken: stillPersisted,
        });
        if (outcome === "rejected") {
          setPersistedToken(false);
          setSessionRejected(true);
          setGraceElapsed(true);
        } else if (outcome === "restored") {
          clearOAuthPending();
          setOAuthPending(false);
          setSessionRejected(false);
        }
        // "inconclusive" deliberately changes nothing: the delayed-restoration
        // state stays, member data is untouched, and retry remains available.
        loadProfile(data.session?.user.id).finally(() => setLoading(false));
      })
      .catch(() => {
        // Transport failure: nothing was decided. Stay on the safe state.
        setLoading(false);
      });

    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const authGate = classifyAuthGate({
    loading,
    hasSession: !!session,
    profileResolved,
    persistedToken,
    oauthPending,
    graceElapsed,
    explicitSignOut,
    profileUnavailable,
    sessionRejected,
  });


  // WO-145Q CORRECTION — privacy-safe correlation for update telemetry: the gate
  // name only, never a token, id or any member data.
  useEffect(() => {
    noteAuthGate(authGate);
  }, [authGate]);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    authGate,
    refreshProfile: async () => {
      await loadProfile(session?.user.id, true);
    },
    /**
     * WO-145Q CORRECTION — the delayed-restoration retry. It re-reads the
     * persisted session and reloads the profile. It never signs out, never
     * clears storage and never discards member data.
     *
     * WO-145R — the retry is also allowed to CONCLUDE: if the server now says
     * the session is rejected (or storage no longer holds one), the member is
     * shown the normal signed-out experience instead of retrying forever.
     */
    retryRestore: async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        setSession(data.session);
        let stillPersisted = false;
        try {
          stillPersisted = hasPersistedAuthToken(window.localStorage, window.sessionStorage);
        } catch {
          stillPersisted = false;
        }
        const outcome = classifyRestoration({
          hasSession: !!data.session,
          error: error ?? null,
          persistedToken: stillPersisted,
        });
        if (outcome === "rejected") {
          setPersistedToken(false);
          setSessionRejected(true);
          setGraceElapsed(true);
          return;
        }
        if (outcome === "restored") setSessionRejected(false);
        if (data.session?.user?.id) await loadProfile(data.session.user.id, true);
      } catch {
        /* offline: the gate stays in its honest delayed state */
      }
    },

    signOut: async () => {
      await supabase.auth.signOut();
      // Belt-and-suspenders: also clear here in case the auth listener races
      // navigation to a signed-out screen.
      qc.clear();
      setProfile(null);
      // WO-145Q: an explicit sign-out is conclusive — no restore window applies,
      // so the signed-out experience renders immediately.
      setPersistedToken(false);
      clearOAuthPending();
      setOAuthPending(false);
      setExplicitSignOut(true);
      setGraceElapsed(true);
      setProfileResolved(false);
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
