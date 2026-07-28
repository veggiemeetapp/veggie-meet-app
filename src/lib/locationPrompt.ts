import { toast } from "sonner";
import {
  getStoredPermission,
  recordPermissionResult,
  requestLocationPermission,
} from "@/lib/permissions";

/**
 * Contextual, one-shot location prompt shown on a distance-using surface
 * (Today "nearby" content). Never fires on Welcome/Auth, never re-asks after
 * the OS or the user has answered once. Denial is non-blocking — VeggieMeet
 * always falls back to Selected City.
 */
export function maybePromptForLocation() {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
  if (getStoredPermission("location")) return; // we already asked once

  // If the Permissions API is available and already resolved, don't re-ask.
  const p: any = (navigator as any).permissions;
  const evaluate = (state: string | undefined) => {
    if (state === "granted" || state === "denied") return;
    toast(
      "Turn on device location to see nearby Meetups and Community Places. You can keep using your Selected City instead.",
      {
        duration: 12_000,
        action: {
          label: "Turn on",
          onClick: () => {
            void requestLocationPermission();
          },
        },
        cancel: {
          label: "Not now",
          onClick: () => {
            void recordPermissionResult("location", "dismissed");
          },
        },
      },
    );
  };

  if (p?.query) {
    p.query({ name: "geolocation" as PermissionName })
      .then((r: any) => evaluate(r?.state))
      .catch(() => evaluate(undefined));
  } else {
    evaluate(undefined);
  }
}
