/**
 * WO-098B — single source of truth for the password rules we communicate.
 *
 * These values were read from the REAL production auth configuration (probed
 * against the live auth endpoint), not from generic provider documentation:
 *
 *   minimum length ............ 6
 *   maximum length ............ 72 bytes (bcrypt hard limit)
 *   uppercase required ........ no
 *   lowercase required ........ no
 *   number required ........... no
 *   special char required ..... no
 *   breached-password reject .. yes (leaked-password protection ON)
 *
 * Signup and password reset are enforced by the same provider policy, so both
 * surfaces render these exact rules.
 *
 * Only rules the backend actually enforces may be listed here.
 */

export const PASSWORD_MIN_LENGTH = 6;
/** bcrypt truncates beyond 72 bytes; the provider rejects longer values. */
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRule = {
  id: "length" | "breach";
  label: string;
  /** Locally checkable rules resolve to true/false; server-only rules to null. */
  check: (password: string) => boolean | null;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    check: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "breach",
    // Never surface the term "HIBP" to members. The browser must never check
    // this — it is verified by the backend on submit only.
    label: "Use a password that hasn't appeared in a known data breach",
    check: () => null,
  },
];

export const PASSWORD_TOO_SHORT_MESSAGE = `Please choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`;
export const PASSWORD_MISMATCH_MESSAGE = "Those passwords don't match.";

/** Local pre-flight only. The backend remains the authority. */
export function isPasswordLongEnough(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}
