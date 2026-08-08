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
