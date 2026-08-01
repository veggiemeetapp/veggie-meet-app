import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget analytics logger (WO-042 §9).
 *
 * Rules:
 * - Never throws to callers; product flows must never fail because of analytics.
 * - Properties must contain no PII: ids of non-user entities, enums, counts only.
 *   No display names, emails, message bodies, free text, or coordinates.
 */
export function logAnalyticsEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    (supabase.rpc as unknown as (
      n: string,
      a?: Record<string, unknown>,
    ) => { then: (ok: () => void, err: () => void) => void })
      .call(supabase, "log_analytics_event", {
        _event_name: event,
        _properties: properties ?? {},
      })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    /* ignore */
  }
}
