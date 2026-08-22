import { toast } from "@/hooks/use-toast";
import { normalizeError, type NormalizedError } from "@/lib/errors";
import { logAnalyticsEvent } from "@/lib/analytics";
import type { ToastActionElement } from "@/components/ui/toast";

/**
 * WO-083 — deduped, member-safe error toasts.
 *
 * Repeated retries or reconnect churn must not flood identical toasts, so the
 * same normalized title is suppressed for a short window.
 */
const DEDUPE_MS = 4000;
const lastShown = new Map<string, number>();

export function showErrorToast(
  error: unknown,
  opts?: { surface?: string; titleOverride?: string; action?: ToastActionElement },
): NormalizedError {
  const normalized = normalizeError(error);
  const title = opts?.titleOverride ?? normalized.title;
  const now = Date.now();
  const key = `${title}|${normalized.description}`;
  const previous = lastShown.get(key);
  if (!previous || now - previous > DEDUPE_MS) {
    lastShown.set(key, now);
    toast({
      title,
      description: normalized.description || undefined,
      variant: "destructive",
      action: opts?.action,
    });
  }
  // Bounded failure telemetry only: category + surface. Never the raw message.
  logAnalyticsEvent("request_failed", {
    category: normalized.category,
    surface: opts?.surface ?? "unknown",
    // WO-124F: bounded, non-PII diagnostic context only.
    code: typeof (error as { code?: unknown })?.code === "string"
      ? ((error as { code: string }).code as string)
      : "none",
    retryable: normalized.retryable,
  });
  return normalized;
}

/** Clear the dedupe window (used when identity changes). */
export function resetErrorToastDedupe() {
  lastShown.clear();
}
