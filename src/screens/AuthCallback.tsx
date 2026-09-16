import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthRestoring } from "@/components/app/AuthRestoring";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  clearOAuthPending,
  consumePostAuthPath,
  hasOAuthCallbackError,
  resolvePostAuthDestination,
} from "@/lib/authRedirect";

const AUTH_FAILURE_PATH = "/onboarding?resume=auth&auth_error=oauth";

/**
 * Public OAuth landing point.
 *
 * A successful provider response is not allowed to touch a private route until
 * Supabase has produced a real session. An unresolved response remains on this
 * neutral restoring screen; only an explicit provider error or Supabase's
 * settled INITIAL_SESSION-without-a-session result returns to sign-in.
 */
export default function AuthCallback() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const finishedRef = useRef(false);
  const callbackHasError = useMemo(
    () => hasOAuthCallbackError(location.search, location.hash),
    [location.hash, location.search],
  );

  useEffect(() => {
    let active = true;

    const finishSuccess = () => {
      if (!active || finishedRef.current) return;
      finishedRef.current = true;
      const destination = resolvePostAuthDestination(consumePostAuthPath());
      clearOAuthPending();
      navigate(destination, { replace: true });
    };

    const finishFailure = () => {
      if (!active || finishedRef.current) return;
      finishedRef.current = true;
      consumePostAuthPath();
      clearOAuthPending();
      navigate(AUTH_FAILURE_PATH, { replace: true });
    };

    if (callbackHasError) {
      finishFailure();
      return () => {
        active = false;
      };
    }

    if (session) {
      finishSuccess();
      return () => {
        active = false;
      };
    }

    // Supabase emits INITIAL_SESSION only after it has finished processing the
    // callback URL. A null value at that point is a settled failure; before that
    // event, absence of a session is merely "not ready yet" and must not route.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      if (next) finishSuccess();
      else if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") finishFailure();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [callbackHasError, navigate, session]);

  return <AuthRestoring />;
}
