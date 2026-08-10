import { logAnalyticsEvent, routeTemplate } from "@/lib/analytics";
import { normalizeError, isDeterministicError, isAuthError } from "@/lib/errors";
import { APP_VERSION } from "@/lib/appVersion";

/**
 * WO-089 — operational (beta health) telemetry.
 *
 * Principles carried forward from WO-083/WO-084:
 * - Observational only. Never a source of product truth, never a mutation.
 * - Fails open: a telemetry problem can never affect a member action.
 * - Bounded vocabulary + bounded, structured, privacy-filtered properties.
 *   Message content, coordinates, emails, names, tokens, raw backend errors and
 *   stack traces are impossible here: the sanitizer (client) and
 *   analytics_sanitize_properties() (server) both strip them.
 * - Expected domain denials (DM before connection, full Meetup, check-in window,
 *   owner route denied) are product outcomes, not operational failures, and are
 *   classified out below so they never flood error monitoring.
 */

export type OpFailureKind =
  | "read"
  | "mutation"
  | "auth"
  | "realtime"
  | "deeplink"
  | "boot";

const EVENT: Record<OpFailureKind, string> = {
  read: "op_read_failed",
  mutation: "op_mutation_failed",
  auth: "op_auth_failed",
  realtime: "op_realtime_failed",
  deeplink: "op_deeplink_failed",
  boot: "op_app_boot_failed",
};

/**
 * Bounded, content-free fingerprint used to group repeated failures:
 * route template + operation + error category/name + app version.
 * Raw error messages are never fingerprinted.
 */
export function errorFingerprint(input: {
  route: string;
  operation: string;
  category: string;
  errorName: string;
}): string {
  const raw = `${input.route}|${input.operation}|${input.category}|${input.errorName}|${APP_VERSION}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return `${input.operation.slice(0, 24)}:${(h >>> 0).toString(36)}`;
}

/**
 * §53 failure-storm rule: at most one persisted event per identical
 * (kind + fingerprint) inside a 60s window, and at most 30 operational events
 * per session-minute overall. A sustained outage still reports one row a minute
 * per distinct failure, so a real incident stays visible.
 */
const FINGERPRINT_WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
let seen = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;

export function resetOpsTelemetry(): void {
  seen = new Map();
  windowStart = 0;
  windowCount = 0;
}

/** True when a failure is an expected product/domain outcome, not an incident. */
export function isExpectedDomainOutcome(error: unknown): boolean {
  return isDeterministicError(error) && !isAuthError(error);
}

export function logOperationalFailure(
  kind: OpFailureKind,
  options: {
    /** Short, stable operation id, e.g. "today_read", "meetup_join". */
    operation: string;
    error?: unknown;
    /** Member surface, e.g. "today", "plans", "dm". */
    surface?: string;
    /** Extra bounded scalar dimensions (sanitized again downstream). */
    extra?: Record<string, string | number | boolean>;
  },
): void {
  try {
    const { operation, error, surface, extra } = options;

    // Expected denials are never operational failures.
    if (kind !== "auth" && error !== undefined && isExpectedDomainOutcome(error)) return;

    const normalized = normalizeError(error);
    const route = routeTemplate(
      typeof window !== "undefined" ? window.location.pathname : undefined,
    );
    const errorName =
      error instanceof Error ? error.name.slice(0, 32) : "unknown";
    const fingerprint = errorFingerprint({
      route,
      operation,
      category: normalized.category,
      errorName,
    });

    const now = Date.now();
    if (now - windowStart > FINGERPRINT_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
      seen = new Map();
    }
    if (windowCount >= MAX_PER_WINDOW) return;
    const key = `${kind}|${fingerprint}`;
    const last = seen.get(key);
    if (last !== undefined && now - last < FINGERPRINT_WINDOW_MS) return;
    seen.set(key, now);
    windowCount += 1;

    logAnalyticsEvent(EVENT[kind], {
      route,
      operation: operation.slice(0, 32),
      surface: surface ?? "unknown",
      error_category: normalized.category,
      error_name: errorName,
      retryable: normalized.retryable,
      online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      app_version: APP_VERSION,
      fingerprint,
      ...(extra ?? {}),
    });
  } catch {
    /* operational telemetry must never affect a product flow */
  }
}
