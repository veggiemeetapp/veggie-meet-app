/**
 * WO-083 — single error-normalization layer.
 *
 * Raw backend errors (PostgREST / PL-pgSQL / fetch) must never reach a member.
 * Everything funnels through `normalizeError` which maps a raw failure onto a
 * bounded set of member-safe categories plus copy that answers:
 *   - what happened
 *   - whether anything was saved
 *   - what to do next
 *
 * Canonical domain messages raised deliberately by our own RPCs (e.g.
 * "This Meetup is full") are preserved verbatim — they are already member-safe
 * and product-approved. Anything that looks like infrastructure detail is
 * replaced with a generic category.
 */

export type ErrorCategory =
  | "offline"
  | "auth_expired"
  | "not_available"
  | "already_handled"
  | "capacity"
  | "rate_limited"
  | "domain"
  | "unknown";

export interface NormalizedError {
  category: ErrorCategory;
  /** Member-safe title for a toast or inline error. */
  title: string;
  /** Member-safe supporting copy. May be empty. */
  description: string;
  /** True when the same action can safely be retried by the member. */
  retryable: boolean;
}

/**
 * Fragments that indicate infrastructure/internals. If a raw message contains
 * any of these it is never shown to a member.
 */
const LEAKY_FRAGMENTS = [
  "invalid input syntax",
  "permission denied",
  "duplicate key",
  "violates",
  "constraint",
  "relation ",
  "column ",
  "sqlstate",
  "pl/pgsql",
  "plpgsql",
  "context:",
  "function public.",
  "public.",
  "jwt",
  "token",
  "bearer",
  "row-level security",
  "rls",
  "stack",
  "at character",
  "postgrest",
  "pgrst",
  "supabase",
  "fetch failed",
  "networkerror",
  "failed to fetch",
  "load failed",
  "internal server error",
  "504",
  "502",
  "500",
];

function rawMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message ?? "";
  if (typeof error === "object") {
    const e = error as { message?: unknown; error_description?: unknown };
    if (typeof e.message === "string") return e.message;
    if (typeof e.error_description === "string") return e.error_description;
  }
  return "";
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object") {
    const e = error as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
  }
  return null;
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown };
    if (typeof e.code === "string") return e.code;
  }
  return "";
}

/** True when the browser currently believes it is offline (hint only). */
function offlineHint(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A transport-level failure: no HTTP response was produced. */
export function isNetworkError(error: unknown): boolean {
  const msg = rawMessage(error).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed") ||
    msg.includes("err_internet_disconnected") ||
    codeOf(error) === "ECONNRESET"
  );
}

/** Authentication/session no longer valid. Never auto-retry these. */
export function isAuthError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 401) return true;
  const msg = rawMessage(error).toLowerCase();
  return (
    msg.includes("not authenticated") ||
    msg.includes("jwt expired") ||
    msg.includes("invalid claim") ||
    msg.includes("session") && msg.includes("expired") ||
    codeOf(error) === "PGRST301"
  );
}

/**
 * Deterministic authorization/domain rejections. Retrying changes nothing, so
 * these must be mapped to state and copy rather than retried.
 */
export function isDeterministicError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429)
    return true;
  // WO-088 DEF-088-03: PostgrestError carries no `status`, so a deliberately
  // raised PL/pgSQL rule (SQLSTATE P0001, and the P0xxx family) used to fall
  // through to the generic "Something went wrong" copy. Any `RAISE EXCEPTION`
  // from one of our own RPCs is a domain rule and is deterministic.
  const code = codeOf(error);
  if (/^P0\d{3}$/.test(code)) return true;
  // Our RPCs raise plain exceptions (HTTP 400 from PostgREST) for every domain
  // rule; treat any explicitly raised message as deterministic.
  const msg = rawMessage(error).toLowerCase();
  return (
    msg.includes("no longer available") ||
    msg.includes("already") ||
    msg.includes("is full") ||
    msg.includes("not available") ||
    msg.includes("not a participant") ||
    msg.includes("not connected") ||
    msg.includes("must be connected") ||
    msg.includes("only open to") ||
    msg.includes("invalid recipient") ||
    msg.includes("too early") ||
    msg.includes("too soon") ||
    msg.includes("too late") ||
    msg.includes("cancelled") ||
    msg.includes("not authorized") ||
    msg.includes("not allowed")
  );
}

/** True when an automatic (non-member-initiated) retry is safe for a read. */
export function isRetryableRead(error: unknown): boolean {
  if (isAuthError(error)) return false;
  if (isDeterministicError(error)) return false;
  return true;
}

function looksLeaky(message: string): boolean {
  const m = message.toLowerCase();
  return LEAKY_FRAGMENTS.some((f) => m.includes(f));
}

/**
 * Canonical domain copy raised by our own RPCs is short, sentence-shaped, and
 * free of infrastructure detail. Anything else is suppressed.
 */
function safeDomainMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (trimmed.length > 160) return null;
  if (looksLeaky(trimmed)) return null;
  if (/[{}<>;]|\$\$|::/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeError(error: unknown): NormalizedError {
  const msg = rawMessage(error);
  const lower = msg.toLowerCase();

  if (isNetworkError(error) || (offlineHint() && !statusOf(error))) {
    return {
      category: "offline",
      title: "You're offline",
      description: "Nothing was saved. Reconnect and try again.",
      retryable: true,
    };
  }

  if (isAuthError(error)) {
    return {
      category: "auth_expired",
      title: "Your session expired",
      description: "Nothing was saved. Sign in again to continue.",
      retryable: false,
    };
  }

  if (statusOf(error) === 429 || lower.includes("too many")) {
    return {
      category: "rate_limited",
      title: "Slow down for a moment",
      description: "You've done that a few times. Try again shortly.",
      retryable: true,
    };
  }

  if (lower.includes("is full") || lower.includes("at capacity")) {
    return {
      category: "capacity",
      title: "This Meetup is full",
      description: "The last seat was taken. Nothing was saved.",
      retryable: false,
    };
  }

  if (lower.includes("already")) {
    const safe = safeDomainMessage(msg);
    return {
      category: "already_handled",
      title: safe ?? "This request has already been handled",
      description: "",
      retryable: false,
    };
  }

  const safe = safeDomainMessage(msg);
  if (safe && isDeterministicError(error)) {
    return {
      category: "domain",
      title: safe,
      description: "",
      retryable: false,
    };
  }

  if (safe && statusOf(error) !== null && statusOf(error)! < 500) {
    return { category: "domain", title: safe, description: "", retryable: false };
  }

  return {
    category: "unknown",
    title: "Something went wrong",
    description: "Nothing was saved. Please try again.",
    retryable: true,
  };
}

/** Convenience: a single member-safe line for compact surfaces. */
export function memberSafeMessage(error: unknown): string {
  const n = normalizeError(error);
  return n.description ? `${n.title}. ${n.description}` : n.title;
}
