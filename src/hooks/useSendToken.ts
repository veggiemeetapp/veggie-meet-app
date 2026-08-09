import { useCallback, useRef } from "react";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID (test/jsdom).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * WO-083 — one idempotency token per *intended* message.
 *
 * The same token is reused while a send for a given body is unresolved, so a
 * retry after an ambiguous network result can never duplicate the message. A
 * confirmed send clears the token, so intentionally sending the same text twice
 * still produces two messages.
 */
export function useSendToken() {
  const ref = useRef<{ token: string; body: string } | null>(null);

  const tokenFor = useCallback((body: string) => {
    if (ref.current && ref.current.body === body) return ref.current.token;
    const token = uuid();
    ref.current = { token, body };
    return token;
  }, []);

  const clear = useCallback(() => {
    ref.current = null;
  }, []);

  return { tokenFor, clear };
}
