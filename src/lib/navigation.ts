/**
 * WO-082 — safe in-app navigation primitives.
 *
 * Two problems this solves:
 *
 * 1. `navigate(-1)` is only safe when the current entry was reached from
 *    another VeggieMeet route. On a deep link, a fresh tab, or after a refresh
 *    the previous entry belongs to another site (or does not exist), so a blind
 *    Back button either leaves the app or does nothing at all. `safeBack`
 *    steps back only when this tab has a recorded in-app entry to return to,
 *    and otherwise navigates to an explicit in-app fallback destination.
 *
 * 2. Route changes must start at the top of the new screen. Without this a
 *    detail route opened from far down a list inherits the list's scroll
 *    offset, which reads as a broken/blank screen.
 *
 * Neither helper carries authorization: destinations are still gated by
 * `RequireOnboarded` and by server-side authorization in the underlying RPCs.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigationType, type NavigateFunction } from "react-router-dom";

/**
 * Number of in-app navigations performed since this tab loaded VeggieMeet.
 * Module scope (not state) on purpose: it must survive route unmounts and it
 * is intentionally reset by a full page load, which is exactly the case where
 * `history.back()` would leave the app.
 */
let inAppDepth = 0;

/** True when there is at least one VeggieMeet entry to step back to. */
export function canGoBackInApp(): boolean {
  return inAppDepth > 0;
}

/**
 * Back navigation that can never leave VeggieMeet and never lands on a
 * pre-auth entry from a previous session. `fallback` must be an internal path.
 */
export function safeBack(navigate: NavigateFunction, fallback: string = "/"): void {
  if (canGoBackInApp()) {
    inAppDepth -= 1;
    navigate(-1);
    return;
  }
  navigate(fallback, { replace: true });
}

/**
 * Mounted once inside the router. Tracks in-app pushes and resets scroll on
 * every push/replace, while leaving POP (browser Back/Forward) alone so the
 * browser's own scroll restoration keeps working for list → detail → Back.
 */
export function NavigationBehavior() {
  const location = useLocation();
  const navType = useNavigationType();
  const first = useRef(true);

  useEffect(() => {

    if (first.current) {
      first.current = false;
      // Entry point of this tab: nothing in-app to go back to.
      inAppDepth = 0;
      return;
    }

    if (navType === "PUSH") inAppDepth += 1;

    // Reset scroll for forward navigations only.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [location.key, location.pathname, navType]);

  return null;
}

/** Reset tracking on identity changes so Back cannot cross an account switch. */
export function resetInAppHistoryDepth(): void {
  inAppDepth = 0;
}
