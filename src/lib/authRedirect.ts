/**
 * WO-073 — safe post-authentication redirect handling.
 *
 * Auth flows accept a "where was the member trying to go?" hint (`?next=`).
 * That value is attacker-controllable, so it is normalized through a single
 * allow-list style sanitizer before it is ever handed to the router.
 *
 * Rules:
 * - Only same-origin *relative* paths are accepted (`/network`, `/meetup/123`).
 * - Everything else is rejected: absolute URLs (`https://evil.test`),
 *   protocol-relative (`//evil.test`), backslash tricks (`/\evil.test`),
 *   scheme-ish values (`javascript:`, `data:`), and control characters.
 * - Authorization is NOT implied. A sanitized destination is still gated by
 *   `RequireOnboarded` and, for owner routes, by the server-side owner check.
 */

const MAX_PATH_LENGTH = 512;
const STASH_KEY = "veggiemeet_post_auth_next";
const OAUTH_PENDING_KEY = "veggiemeet_oauth_pending";
export const OAUTH_PENDING_CHANGE_EVENT = "veggiemeet:oauth-pending-change";
export const AUTH_CALLBACK_PATH = "/auth/callback";

function notifyOAuthPendingChanged(): void {
  try {
    window.dispatchEvent(new Event(OAUTH_PENDING_CHANGE_EVENT));
  } catch {
    /* SSR / non-DOM test environment */
  }
}

/**
 * Long enough for account selection / MFA at Google, but bounded so abandoning
 * the provider flow cannot leave this tab in a permanent restoration state.
 */
export const OAUTH_PENDING_TTL_MS = 15 * 60_000;

export function sanitizeInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  // Tolerate a single layer of encoding so `%2Fnetwork` still resolves, while
  // decoded payloads (e.g. `%2F%2Fevil.test`) are re-validated below.
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  value = value.trim();
  if (!value || value.length > MAX_PATH_LENGTH) return null;
  // Control characters (incl. newlines / tabs used for header or URL smuggling).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  // No backslashes anywhere — browsers normalize `\` to `/` in URLs.
  if (value.includes("\\")) return null;
  // Must be a rooted relative path, never protocol-relative.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Defensive: reject anything that still parses as an absolute URL.
  try {
    const parsed = new URL(value, "https://veggiemeet.invalid");
    if (parsed.origin !== "https://veggiemeet.invalid") return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

/**
 * Remember an intended destination across a full-page OAuth round trip.
 * `sessionStorage` is used on purpose: it is per-tab and cleared with the tab,
 * and it holds no identity — only a route string.
 */
export function stashPostAuthPath(raw: string | null | undefined): void {
  const safe = sanitizeInternalPath(raw);
  try {
    if (safe) sessionStorage.setItem(STASH_KEY, safe);
    else sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* storage unavailable — deep link simply falls back to Today */
  }
}

/** Read-and-clear the stashed destination. Re-sanitized on the way out. */
export function consumePostAuthPath(): string | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    return sanitizeInternalPath(raw);
  } catch {
    return null;
  }
}

/**
 * Auth surfaces are never valid destinations after a successful sign-in. A
 * stale `next=/onboarding` was able to send a valid member straight back to
 * the sign-in page, which looked like a failed OAuth round trip.
 */
export function resolvePostAuthDestination(
  raw: string | null | undefined,
): string {
  const safe = sanitizeInternalPath(raw);
  if (!safe) return "/";
  const pathname = new URL(safe, "https://veggiemeet.invalid").pathname;
  if (
    pathname === "/onboarding" ||
    pathname === AUTH_CALLBACK_PATH ||
    pathname === "/reset-password" ||
    pathname.startsWith("/.lovable/oauth/")
  ) {
    return "/";
  }
  return safe;
}

/** Provider callbacks may report failures in either the query or hash. */
export function hasOAuthCallbackError(search: string, hash: string): boolean {
  for (const raw of [search, hash]) {
    const params = new URLSearchParams(raw.replace(/^[?#]/, ""));
    if (
      params.has("error") ||
      params.has("error_code") ||
      params.has("error_description")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Mark a full-page OAuth round trip before leaving the app. Unlike a persisted
 * Supabase token, this marker means a brand-new session may still be arriving,
 * so route guards must not classify the callback as a signed-out visit yet.
 */
export function markOAuthPending(now = Date.now()): void {
  try {
    sessionStorage.setItem(OAUTH_PENDING_KEY, String(now));
  } catch {
    /* storage unavailable — normal auth hydration remains the fallback */
  }
  notifyOAuthPendingChanged();
}

/** True only for a recent OAuth round trip in this browser tab. */
export function hasPendingOAuth(now = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(OAUTH_PENDING_KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    const age = now - startedAt;
    if (!Number.isFinite(startedAt) || age < 0 || age > OAUTH_PENDING_TTL_MS) {
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearOAuthPending(): void {
  try {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
  } catch {
    /* ignore unavailable storage */
  }
  notifyOAuthPendingChanged();
}
