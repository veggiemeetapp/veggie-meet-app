import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    // Bounded operational log only.
    console.warn("[404]", location.pathname);
  }, [location.pathname]);

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
        <Link
          to="/"
          className="inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Return to Today
        </Link>
      </div>
    </main>
  );
};

export default NotFound;
