import { Sprout } from "lucide-react";
import { NotificationsBell, UserAvatar } from "@/components/app";

import { CitySelector } from "@/components/location/CitySelector";
import { useAuth } from "@/hooks/useAuth";

export function TodayHeader() {
  const { profile } = useAuth();
  const name = (profile?.display_name ?? "Veggie").trim().split(/\s+/)[0] || "Veggie";

  return (
    <header className="safe-top px-5 pt-4 pb-3 bg-background">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          {/* DEF-092A-01: the wordmark used a colour emoji, which falls back to
              an empty outlined box wherever no emoji font is installed. */}
          <Sprout className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="font-semibold tracking-tight text-charcoal">
            VeggieMeet
          </span>
        </div>


        <div className="flex items-center gap-1 shrink-0">
          <NotificationsBell />
          <button
            type="button"
            aria-label="Open profile"
            className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserAvatar
              name={profile?.display_name ?? "You"}
              src={profile?.avatar_url ?? undefined}
              size="md"
            />
          </button>
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
