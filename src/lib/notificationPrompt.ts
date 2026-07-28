import { toast } from "sonner";
import {
  getStoredPermission,
  recordPermissionResult,
  requestNotificationPermission,
} from "@/lib/permissions";

/**
 * Show a contextual, one-shot notifications prompt after a notification-worthy
 * action (connection request sent, meetup joined, invitation accepted, etc.).
 *
 * - Never shown on Welcome/Auth screens (only invoked from action call sites).
 * - Never re-asks if the OS state is `granted`, `denied`, or the user has
 *   already answered our in-app prompt (stored in localStorage + DB).
 */
export function maybePromptForNotifications() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  const os = window.Notification.permission;
  if (os === "granted" || os === "denied") return; // OS-level decision already made
  if (getStoredPermission("notification")) return; // We already asked

  toast(
    "Turn on notifications so you don't miss connection requests, Meetup updates, or invitations.",
    {
      duration: 12_000,
      action: {
        label: "Allow",
        onClick: () => {
          void requestNotificationPermission();
        },
      },
      cancel: {
        label: "Not now",
        onClick: () => {
          void recordPermissionResult("notification", "dismissed");
        },
      },
    },
  );
}
