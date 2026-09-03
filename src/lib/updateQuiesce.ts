/**
 * WO-145E — quiesce long-lived backend connections before activating a build.
 *
 * Measured in Chromium against real production builds: an outgoing service
 * worker is only replaced once it has no work in flight. VeggieMeet keeps
 * long-lived backend connections open for realtime chat, reactions and
 * notification badges, so a consented `SKIP_WAITING` was accepted by the waiting
 * worker while `skipWaiting()` never resolved — the member sat on "Updating…"
 * until the bounded timeout, and the same client activated instantly once those
 * connections were closed.
 *
 * This helper closes exactly those connections (never the auth session, never
 * caches, never the registration) immediately before activation. The client is
 * about to reload onto the new build, which re-subscribes on boot, so nothing is
 * lost; if activation is refused or fails, the reload never happens and the
 * subscriptions are re-established by the normal query/realtime lifecycle.
 */
import { supabase } from "@/integrations/supabase/client";

interface RealtimeLike {
  removeAllChannels?: () => unknown;
  realtime?: { disconnect?: () => unknown };
}

/** Close realtime channels and the realtime socket. Never throws. */
export function quiesceBackendConnections(client: unknown = supabase): void {
  const c = client as RealtimeLike | null;
  if (!c) return;
  try {
    c.removeAllChannels?.();
  } catch {
    /* a failed teardown must never block the member's update */
  }
  try {
    c.realtime?.disconnect?.();
  } catch {
    /* ditto */
  }
}
