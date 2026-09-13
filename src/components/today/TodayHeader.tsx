import { Sprout } from "lucide-react";
import { Link } from "react-router-dom";
import { NotificationsBell, UserAvatar } from "@/components/app";

import { CitySelector } from "@/components/location/CitySelector";
import { useAuth } from "@/hooks/useAuth";

export function TodayHeader() {
  const { profile } = useAuth();
  const name = (profile?.display_name ?? "Veggie").trim().split(/\s+/)[0] || "Veggie";

  return (
    <header className="safe-top px-5 pt-4 pb-3 bg-background">
      <div className="flex items-center justify-between gap-2 min-w-0">
        {/* WO-095B DEF-095A-05: the wordmark block was `shrink-0`, so at 200%
            text it kept its full width and pushed the header controls off the
            right edge of the document. It now truncates instead. */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* DEF-092A-01: the wordmark used a colour emoji, which falls back to
              an empty outlined box wherever no emoji font is installed. */}
          <Sprout className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="font-semibold tracking-tight text-charcoal truncate">
            VeggieMeet
          </span>
        </div>



        <div className="flex items-center gap-1 shrink-0">
          <NotificationsBell />
          <Link
            to="/you"
            aria-label="Open my profile"
            className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserAvatar
              name={profile?.display_name ?? "You"}
              src={profile?.avatar_url ?? undefined}
              size="md"
            />
          </Link>
        </div>
      </div>

      <div className="mt-4 min-w-0">
        <CitySelector />
      </div>

      <div className="mt-4 min-w-0">
        <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-charcoal break-words">
          Welcome back, {name}
        </h1>

        <p className="mt-1 text-sm text-charcoal-muted">
          Ready to see what's happening today?
        </p>
      </div>
    </header>
  );
}
