import { Capacitor } from "@capacitor/core";

/**
 * "View Place" from inside a form opens the place in a new tab on the web so
 * the draft survives. The native shell has no tabs: WKWebView hands every
 * `window.open` to the system, and a relative app URL simply goes nowhere, so
 * the native app navigates in place instead.
 */
export function openPlacePage(placeId: string): void {
  const path = `/place/${placeId}`;
  if (Capacitor.isNativePlatform()) {
    window.location.assign(path);
    return;
  }
  window.open(path, "_blank", "noopener,noreferrer");
}
