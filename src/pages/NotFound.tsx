import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

/**
 * WO-082: the 404 CTA must be auth-aware. Sending a signed-out or
 * mid-onboarding visitor to "Today" produced an immediate redirect to
 * /onboarding, which read as a broken loop. The destination is therefore
 * derived from the resolved auth/onboarding state, and nothing is rendered
 * about the requested path itself.
 */
const NotFound = () => {
  const location = useLocation();
  const { session, profile, loading } = useAuth();

  useEffect(() => {
    // Bounded operational log only — path only, never query string.
    console.warn("[404]", location.pathname);
  }, [location.pathname]);

  const onboarded = !!session && !!profile?.onboarding_completed;
  const cta = onboarded
    ? { to: "/", label: "Return to Today" }
    : { to: "/onboarding", label: "Go to sign in" };

  return (
    <main
      role="main"
      className="flex min-h-dvh items-center justify-center bg-background px-6"
    >
      <div className="text-center max-w-sm">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-charcoal">
          Page not found
        </h1>
        <p className="mb-6 text-sm text-charcoal-muted leading-relaxed">
          The page you're looking for is no longer available.
        </p>
        {!loading && (
          <Link
            to={cta.to}
            className="inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            {cta.label}
          </Link>
        )}
      </div>
    </main>
  );
};

export default NotFound;
