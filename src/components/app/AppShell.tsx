import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { AppErrorBoundary } from "./ErrorBoundary";
import { OfflineBanner } from "./OfflineBanner";
import { FollowUpPrompt } from "@/components/postmeetup/FollowUpPrompt";
import { useAuth } from "@/hooks/useAuth";

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


  return (
    <div className="min-h-dvh w-full bg-muted/40 flex justify-center">
      <div className="relative w-full max-w-phone bg-background min-h-dvh shadow-float flex flex-col">
        <OfflineBanner />
        <main
          className="flex-1 flex flex-col"
          style={{ paddingBottom: hideNav ? 0 : "calc(var(--nav-height) + env(safe-area-inset-bottom))" }}
        >
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </main>
        {!hideNav && <BottomNav />}
        <FollowUpPrompt />
      </div>
    </div>
  );
}

