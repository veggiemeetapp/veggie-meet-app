/**
 * WO-145R — classify a persisted-session restoration attempt.
 *
 * The distinction this file exists for: a CONCLUSIVE negative (expired or
 * revoked refresh token, session removed from storage, a real SIGNED_OUT event)
 * must expose the normal signed-out experience, while an INCONCLUSIVE failure
 * (offline, timeout, 5xx, rate limit) must keep the safe delayed-restoration
 * state and must never expose onboarding.
 *
 * Nothing here reads, logs or transmits token material.
 */
import { hasPersistedAuthToken, type StorageLike } from "@/lib/authHydration";

export type RestorationOutcome =
  /** A session was restored. */
  | "restored"
  /** Conclusively no session: expired, revoked, or removed. */
  | "rejected"
  /** Could not be determined (offline / 5xx / timeout): stay safe. */
  | "inconclusive";

interface ErrorLike {
  status?: number;
  code?: string;
  name?: string;
  message?: string;
}

/** Auth-server statuses that conclusively mean "this session is not valid". */
const CONCLUSIVE_STATUSES = new Set([400, 401, 403]);

const CONCLUSIVE_CODES = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "invalid_grant",
  "bad_jwt",
]);

export function classifyRestoration(input: {
  hasSession: boolean;
  error?: ErrorLike | null;
  /** Storage still holds a persisted session for some account. */
  persistedToken: boolean;
}): RestorationOutcome {
  if (input.hasSession) return "restored";

  const error = input.error ?? null;
  if (error) {
    const code = (error.code ?? "").toLowerCase();
    if (CONCLUSIVE_CODES.has(code)) return "rejected";
    if (typeof error.status === "number") {
      if (CONCLUSIVE_STATUSES.has(error.status)) return "rejected";
      // 5xx, 429, 0/undefined network failures: nothing was decided.
      return "inconclusive";
    }
    // A transport failure ("Failed to fetch", AbortError) decides nothing.
    return "inconclusive";
  }

  // No error and no session. If storage no longer holds a session either, the
  // client library has already discarded a rejected session: that is settled.
  if (!input.persistedToken) return "rejected";

  // A token is still persisted but no session came back and no error was
  // reported — the refresh may still be in flight. Stay safe.
  return "inconclusive";
}

/** Convenience wrapper reading the real browser stores. */
export function persistedSessionPresent(
  ...stores: (StorageLike | null | undefined)[]
): boolean {
  return hasPersistedAuthToken(...stores);
}
