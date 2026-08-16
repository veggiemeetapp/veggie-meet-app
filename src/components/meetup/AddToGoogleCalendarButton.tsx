import { useRef } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { logAnalyticsEvent } from "@/lib/analytics";
import { buildGoogleCalendarUrl } from "@/lib/calendar";
import type { Meetup } from "@/types";

/**
 * WO-117 — optional, one-time Google Calendar export.
 *
 * Never touches RSVP state: this is pure URL generation opened straight from the
 * user gesture (so popup blockers stay quiet). No OAuth, no tokens, no sync.
 */
interface Props {
  meetup: Meetup;
  surface: "post_join" | "meetup_detail";
  variant?: "link" | "outline";
  className?: string;
}

export function AddToGoogleCalendarButton({
  meetup,
  surface,
  variant = "link",
  className,
}: Props) {
  const busy = useRef(false);

  const onClick = () => {
    // Lightweight guard: a rapid double tap must not open two tabs.
    if (busy.current) return;
    busy.current = true;
    window.setTimeout(() => {
      busy.current = false;
    }, 800);

    const url = buildGoogleCalendarUrl(meetup);
    if (!url) {
      toast({
        title: "Couldn’t open Google Calendar. Please try again.",
        variant: "destructive",
      });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    logAnalyticsEvent("meetup_add_to_calendar", {
      meetup_id: meetup.id,
      provider: "google_calendar",
      surface,
    });
  };

  const styles =
    variant === "outline"
      ? "w-full min-h-11 rounded-full border border-border bg-background px-4 text-sm font-semibold text-charcoal"
      : "min-h-11 text-sm font-semibold text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 ${styles} ${className ?? ""}`}
    >
      <CalendarPlus className="w-4 h-4" aria-hidden="true" />
      Add to Google Calendar
    </button>
  );
}
