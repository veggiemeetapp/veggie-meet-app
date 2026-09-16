import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { AppErrorBoundary } from "./ErrorBoundary";
import { OfflineBanner } from "./OfflineBanner";
import { FollowUpPrompt } from "@/components/postmeetup/FollowUpPrompt";
import { useAuth } from "@/hooks/useAuth";
import { titleForPath } from "@/lib/pageTitle";

interface AppShellProps {
  children: ReactNode;
}

// Routes that hide bottom nav (focused flows)
const HIDDEN_NAV_PATTERNS = [/^\/meetup\//, /^\/join\//, /^\/group\//, /^\/chat\//, /^\/dm\//, /^\/meetup-created\//, /^\/onboarding/, /^\/you\/edit/, /^\/checkin\//, /^\/veggie\//, /^\/notifications/, /^\/settings/, /^\/owner\//, /^\/\.lovable\/oauth\//];

export function AppShell({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const { session, profile, loading } = useAuth();
  // WO-073: authenticated chrome must never flash for a signed-out visitor or
  // while auth is still resolving. The nav is shown only once we know the
  // session belongs to a fully onboarded member.
  const authedShell = !loading && !!session && !!profile?.onboarding_completed;
  const hideNav = !authedShell || HIDDEN_NAV_PATTERNS.some((r) => r.test(pathname));

  // WO-085 DEF-085-03 (WCAG 2.4.2): route-template document titles.
  // WO-085 DEF-085-06 (WCAG 2.4.3 / 4.1.3): on a route change, move focus to
  // the main region and announce the new surface politely, so keyboard and
  // screen-reader members are told the page changed instead of being left at
  // the top of a stale tab order.
  const mainRef = useRef<HTMLElement | null>(null);
  const first = useRef(true);
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    const title = titleForPath(pathname);
    document.title = title;
    const label = title.split(" | ")[0];
    if (first.current) {
      first.current = false;
      return;
    }
    setAnnounced(label);
    // Programmatic focus without a visible outline on the container itself:
    // the next Tab continues from main, which is the predictable destination.
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return (
    <div className="min-h-dvh w-full bg-muted/40 flex justify-center">
      <div className="relative w-full max-w-phone bg-background min-h-dvh shadow-float flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:left-3 focus:top-3 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <OfflineBanner />
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 flex flex-col outline-none"
          style={{ paddingBottom: hideNav ? 0 : "calc(var(--nav-height) + env(safe-area-inset-bottom))" }}
        >
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </main>
        {/* WO-141: `sr-only` is absolutely positioned, but without explicit
            coordinates its static position remained after the 100dvh chat.
            That added a 1px element plus body line-height below the viewport,
            exposing the shell's grey background when mobile Safari bounced or
            the document was scrolled. Anchor the live region inside this
            relative shell so it remains accessible without affecting bounds. */}
        <p
          aria-live="polite"
          data-route-announcer
          className="sr-only left-0 top-0"
        >
          {announced}
        </p>
        {!hideNav && <BottomNav />}
        <FollowUpPrompt />
      </div>
    </div>
  );
}
