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

const CALLBACK_SETTLE_MS = 10_000;
const AUTH_FAILURE_PATH = "/onboarding?resume=auth&auth_error=oauth";

/**
 * One public landing point for provider redirects. It never renders onboarding
 * while success is still settling: a real session goes to the requested app
 * route (Today by default), while an explicit/settled failure returns to auth.
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
      // A failed identity must not leave a destination for the next person who
      // signs in on this tab.
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

    // Subscribe before the explicit read so a fast SIGNED_IN event cannot be
    // missed between render and getSession().
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next) finishSuccess();
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || finishedRef.current) return;
      if (data.session) finishSuccess();
      else if (error) finishFailure();
    });

    const timeoutId = window.setTimeout(finishFailure, CALLBACK_SETTLE_MS);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      subscription.subscription.unsubscribe();
    };
  }, [callbackHasError, navigate, session]);

  return <AuthRestoring />;
}
