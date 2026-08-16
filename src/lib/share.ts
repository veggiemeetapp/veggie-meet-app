import { toast } from "@/hooks/use-toast";
import { logAnalyticsEvent } from "@/lib/analytics";

/**
 * WO-115 — one shared share path for every VeggieMeet surface.
 *
 * Native Web Share when the browser exposes it, clipboard copy otherwise, and
 * never a silent dead interaction. User cancellation (AbortError) is a normal
 * outcome: no toast, no clipboard fallback.
 */
export const PRODUCTION_ORIGIN = "https://veggiemeet.app";

/** Canonical, member-shareable URL for a Meetup detail page. */
export function meetupShareUrl(meetupId: string) {
  return `${PRODUCTION_ORIGIN}/meetup/${meetupId}`;
}

export type ShareMethod = "native_share" | "clipboard" | "cancelled" | "failed";

export interface ShareOrCopyInput {
  title: string;
  text: string;
  url: string;
  copiedMessage?: string;
  errorMessage?: string;
  analyticsEvent?: string;
  analyticsMeta?: Record<string, string>;
}

async function copyToClipboard(url: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  throw new Error("clipboard-unavailable");
}

export async function shareOrCopy(input: ShareOrCopyInput): Promise<ShareMethod> {
  const {
    title,
    text,
    url,
    copiedMessage = "Link copied",
    errorMessage = "Couldn’t share this. Please try again.",
    analyticsEvent,
    analyticsMeta,
  } = input;

  const log = (method: ShareMethod) => {
    if (analyticsEvent) logAnalyticsEvent(analyticsEvent, { ...analyticsMeta, method });
  };

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      log("native_share");
      return "native_share";
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? "";
      // Deliberate dismissal is not a failure and must stay silent.
      if (name === "AbortError") return "cancelled";
    }
  }

  try {
    await copyToClipboard(url);
    toast({ title: copiedMessage });
    log("clipboard");
    return "clipboard";
  } catch {
    toast({ title: errorMessage, variant: "destructive" });
    return "failed";
  }
}

/** In-flight guard so rapid taps cannot open several share requests. */
export function createShareGuard() {
  let inFlight = false;
  return async function run(fn: () => Promise<unknown>) {
    if (inFlight) return;
    inFlight = true;
    try {
      await fn();
    } finally {
      inFlight = false;
    }
  };
}
