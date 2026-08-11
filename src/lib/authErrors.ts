/**
 * WO-098 — bounded, member-safe auth error mapping.
 *
 * Supabase auth returns provider-shaped messages ("Invalid login credentials",
 * "AuthApiError: ..."). Those must never reach a member verbatim: they read as
 * developer text and can leak provider/backend details. Every auth failure is
 * therefore collapsed into a small, fixed set of member-facing states.
 *
 * Categories are also the ONLY thing forwarded to telemetry — never the raw
 * message, never the email, never the password, never a token.
 */

export type AuthErrorCategory =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "link_expired"
  | "rate_limited"
  | "weak_password"
  | "compromised_password"
  | "email_taken"
  | "invalid_email"
  | "offline"
  | "unknown";

export type MappedAuthError = {
  category: AuthErrorCategory;
  /** Short member-facing sentence. Safe to render and to read aloud. */
  message: string;
};

const MAP: Array<{ test: RegExp; category: AuthErrorCategory; message: string }> = [
  {
    test: /invalid login credentials|invalid credentials|wrong password/i,
    category: "invalid_credentials",
    message: "That email and password don't match. Try again, or reset your password.",
  },
  {
    test: /email not confirmed|not confirmed/i,
    category: "email_not_confirmed",
    message: "Please confirm your email first — check your inbox for the VeggieMeet link.",
  },
  {
    test: /expired|invalid token|token has expired|otp_expired|invalid or has expired/i,
    category: "link_expired",
    message: "That link has expired or was already used. Request a new one to continue.",
  },
  {
    test: /rate limit|too many requests|over_email_send_rate_limit|for security purposes/i,
    category: "rate_limited",
    message: "Too many attempts just now. Please wait a minute and try again.",
  },
  {
    test: /pwned|compromised|leaked|data breach/i,
    category: "compromised_password",
    message:
      "That password has appeared in a known data breach. Please choose a different one.",
  },
  {
    test: /password should be|password is too short|weak password|at least 6/i,
    category: "weak_password",
    message: "Please choose a longer password — at least 6 characters.",
  },
  {
    test: /already registered|already exists|user already/i,
    category: "email_taken",
    message: "If that email can be used, we've sent it a confirmation link.",
  },
  {
    test: /invalid email|unable to validate email/i,
    category: "invalid_email",
    message: "That email address doesn't look right. Please check it and try again.",
  },
  {
    test: /failed to fetch|network|offline|load failed/i,
    category: "offline",
    message: "You appear to be offline. Check your connection and try again.",
  },
];

/** Map any thrown/returned auth error into a bounded member-safe state. */
export function mapAuthError(error: unknown): MappedAuthError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      category: "offline",
      message: "You appear to be offline. Check your connection and try again.",
    };
  }
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  for (const entry of MAP) {
    if (entry.test.test(raw)) return { category: entry.category, message: entry.message };
  }
  return {
    category: "unknown",
    message: "Something went wrong on our side. Please try again in a moment.",
  };
}

/**
 * Strip anything token-bearing out of a URL before it can reach analytics,
 * telemetry or a log line. Recovery/confirmation links carry credentials in
 * both the query string and the hash fragment, so both are dropped entirely.
 */
export function redactAuthUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://veggiemeet.invalid");
    return parsed.pathname;
  } catch {
    return "/";
  }
}
