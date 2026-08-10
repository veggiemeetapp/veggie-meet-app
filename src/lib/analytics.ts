import { supabase } from "@/integrations/supabase/client";

/**
 * WO-084 — analytics is an observation layer, never a source of truth.
 *
 * Rules enforced here (and independently re-enforced inside the trusted
 * `log_analytics_event` SECURITY DEFINER function, which is authoritative):
 *
 * - Event names come from a controlled allowlist. Unknown names are dropped
 *   client-side and ignored server-side, so the analytics schema stays bounded.
 * - Actor attribution is derived from the session on the server. The client
 *   never supplies profile_id / auth_user_id.
 * - Payloads are depth-1 only, bounded in key count and string length, and any
 *   sensitive key (email, tokens, coordinates, message/report/profile text,
 *   raw search terms, raw error text) is stripped.
 * - Logging is fire-and-forget and never throws: a failed or slow analytics
 *   write can never block or fail a product action.
 */

/** Controlled event vocabulary. Must stay in sync with analytics_event_allowed(). */
export const ANALYTICS_EVENTS = [
  // WO-084A DEF-084A-05: the four primary member surfaces had no view event,
  // so the beta funnel could not be measured end to end.
  "today_opened",
  "community_home_opened",
  "notifications_opened",
  "you_opened",
  "account_deletion_blocked",
  "account_deletion_completed",
  "account_deletion_started",
  "auth_signin_success",
  "auth_signup_started",
  "auth_signup_success",
  "check_in_started_from_plans",
  "community_impact_place_count_updated",
  "community_place_card_opened",
  "community_place_check_in_failed",
  "community_place_check_in_started",
  "community_place_check_in_succeeded",
  "community_place_detail_opened",
  "community_place_directions_opened",
  "community_place_edit_blocked",
  "community_place_edit_completed",
  "community_place_edit_google_checked",
  "community_place_edit_opened",
  "community_place_edit_previewed",
  "community_place_host_started",
  "community_place_identity_review_blocked",
  "community_place_identity_review_cancelled",
  "community_place_identity_review_completed",
  "community_place_identity_review_opened",
  "community_place_identity_review_started",
  "community_place_meetup_opened",
  "community_place_operations_activity_loaded_more",
  "community_place_operations_attention_opened",
  "community_place_operations_filter_changed",
  "community_place_operations_place_opened",
  "community_place_report_blocked",
  "community_place_report_history_opened",
  "community_place_report_moderated",
  "community_place_report_notification_opened",
  "community_place_report_owner_opened",
  "community_place_report_started",
  "community_place_report_submitted",
  "community_place_reverification_cancelled",
  "community_place_reverification_completed",
  "community_place_reverification_queue_opened",
  "community_place_reverification_started",
  "community_place_shared",
  "community_place_suggestion_failed",
  "community_place_suggestion_owner_opened",
  "community_place_suggestion_promoted",
  "community_place_suggestion_started",
  "community_place_suggestion_submitted",
  "community_place_vegan_review_blocked",
  "community_place_vegan_review_cancelled",
  "community_place_vegan_review_completed",
  "community_place_vegan_review_opened",
  "community_place_vegan_review_started",
  "community_places_filter_changed",
  "community_places_opened",
  "discovery_settings_saved",
  "error_boundary_activated",
  "location_permission_result",
  "meetup_check_in_blocked",
  "meetup_check_in_completed",
  "meetup_check_in_started",
  "meetup_community_place_opened",
  "meetup_community_place_selected",
  "meetup_community_place_viewed",
  "meetup_completion_blocked",
  "meetup_completion_completed",
  "meetup_completion_started",
  "meetup_created",
  "meetup_created_at_community_place",
  "meetup_left_from_plans",
  "meetup_location_change_notification_opened",
  "meetup_location_mode_selected",
  "meetup_location_review_opened",
  "meetup_location_update_blocked",
  "meetup_location_update_completed",
  "meetup_location_update_started",
  "member_blocked",
  "member_reported",
  "my_plans_opened",
  "notification_permission_result",
  "notification_preference_changed",
  "offline_detected",
  "onboarding_completed",
  "onboarding_starting_action_chosen",
  "onboarding_step_completed",
  "onboarding_step_viewed",
  "place_suggestion_history_opened",
  "place_suggestion_notification_created",
  "place_suggestion_notification_opened",
  "plan_opened",
  "profile_visibility_changed",
  "reconnect_completed",
  "request_failed",
  "settings_opened",
  "settings_profile_updated",
  "sign_out_completed",
  "supported_place_card_opened",
  "supported_places_explore_clicked",
  "supported_places_opened",
  // WO-089 — operational failure vocabulary (bounded, content-free).
  "op_read_failed",
  "op_mutation_failed",
  "op_auth_failed",
  "op_realtime_failed",
  "op_deeplink_failed",
  "op_app_boot_failed",
  // WO-089 — private beta feedback + owner beta operations.
  "beta_feedback_opened",
  "beta_feedback_submitted",
  "beta_feedback_failed",
  "owner_beta_operations_opened",
  "owner_beta_feedback_status_updated",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

const ALLOWED = new Set<string>(ANALYTICS_EVENTS);

/** Sensitive property keys that must never reach telemetry. */
// Must stay a mirror of public.analytics_sanitize_properties()'s denylist so a
// forbidden key can never reach the DB guard and turn telemetry into an error.
// Deliberately NOT blocking the tokens `name`, `location` or `report` as
// prefixes/suffixes: `error_name`, `location_source` and `report_id` are all
// approved, non-identifying dimensions. Their bare forms are blocked exactly.
const DENY_KEY =
  /(^|_)(e?mail|token|jwt|password|secret|auth_user_id|user_id|profile_id|actor_id|recipient_id|sender_id|member_id|uid|lat|latitude|lng|lon|longitude|coord|coords|coordinate|coordinates|geo|geolocation|accuracy|position|address|location_name|place_name|body|content|message|bio|display_name|full_name|first_name|last_name|query|search_term|q|details_text|explanation|reason_text|note|stack|sql|raw_error)($|_)/i;

const DENY_EXACT = new Set(["report", "name", "location", "details", "text"]);

const MAX_KEYS = 12;
const MAX_STRING = 64;

/** Depth-1, bounded, privacy-filtered property map. */
export function sanitizeAnalyticsProperties(
  properties?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!properties) return out;
  let n = 0;
  for (const [k, v] of Object.entries(properties)) {
    if (n >= MAX_KEYS) break;
    if (k.length > 40) continue;
    if (DENY_EXACT.has(k.toLowerCase()) || DENY_KEY.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue; // nested payloads are never logged
    if (typeof v === "function" || typeof v === "symbol") continue;
    out[k] = typeof v === "string" ? v.slice(0, MAX_STRING) : v;
    n += 1;
  }
  return out;
}

/**
 * Route template instead of a raw URL (WO-084 §22): identifiers are collapsed
 * and query strings — which can carry search terms or `next` params — dropped.
 */
export function routeTemplate(pathname?: string): string {
  if (!pathname) return "unknown";
  const path = pathname.split("?")[0].split("#")[0];
  return (
    path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/:id",
      )
      .replace(/\/\d+/g, "/:n")
      .slice(0, 64) || "/"
  );
}

/**
 * Short-window dedupe for *view*-style events only. Guards against React
 * StrictMode double effects, remounts and focus refetches emitting the same
 * logical screen view twice. Conversion/outcome events are never deduped here —
 * their exactly-once semantics come from the canonical server mutation.
 */
const VIEW_EVENT = /(_opened|_viewed|_result|_detected|_completed_view)$/;
const VIEW_DEDUPE_MS = 1500;
let recentViews = new Map<string, number>();

/**
 * DEF-084A-01 — funnel ordering.
 *
 * Writes are serialized through a single in-flight chain so the persisted
 * `created_at` order always matches emission order (e.g. `auth_signup_started`
 * can never land after `auth_signup_success`, and `*_viewed` never lands after
 * the matching `*_completed`). Still fully non-blocking: callers never await,
 * and a rejected link can never break the chain or surface to the product.
 */
let chain: Promise<void> = Promise.resolve();

/** Called on sign-out / account switch so no dedupe state crosses identities. */
export function resetAnalyticsIdentity(): void {
  recentViews = new Map();
  // Any queued-but-unsent writes belong to the previous session; drop the
  // chain reference so a new identity starts from a clean queue.
  chain = Promise.resolve();
}

export function logAnalyticsEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    if (!ALLOWED.has(event)) return; // unbounded vocabulary is not possible

    const props = sanitizeAnalyticsProperties(properties);

    if (VIEW_EVENT.test(event)) {
      const key = `${event}|${JSON.stringify(props)}`;
      const now = Date.now();
      const last = recentViews.get(key);
      if (last !== undefined && now - last < VIEW_DEDUPE_MS) return;
      recentViews.set(key, now);
      if (recentViews.size > 64) recentViews = new Map([[key, now]]);
    }

    chain = chain.then(
      () =>
        new Promise<void>((resolve) => {
          try {
            (supabase.rpc as unknown as (
              n: string,
              a?: Record<string, unknown>,
            ) => { then: (ok: () => void, err: () => void) => void })
              .call(supabase, "log_analytics_event", {
                _event_name: event,
                _properties: props,
              })
              .then(
                () => resolve(),
                () => resolve(),
              );
          } catch {
            resolve();
          }
        }),
      () => undefined,
    );
  } catch {
    /* analytics is best-effort and must never affect a product flow */
  }
}

