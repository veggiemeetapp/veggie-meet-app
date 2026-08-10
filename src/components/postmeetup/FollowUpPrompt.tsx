import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PrimaryButton, SecondaryButton } from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { logAnalyticsEvent } from "@/lib/analytics";
import { logOperationalFailure } from "@/lib/opsTelemetry";
import { isRetryableRead } from "@/lib/errors";
import {
  dismissFollowUp,
  fetchPendingFollowUp,
  markFollowUpViewed,
} from "@/lib/postMeetup";

// WO-090 §8 — routes where we won't interrupt the member with the follow-up
// prompt. The prompt may appear on passive landing/discovery surfaces, but never
// during onboarding/auth, a focused form, a safety action, an account action,
// check-in/QR, messaging, owner operations, or the canonical follow-up surface
// itself (which owns the task).
const SUPPRESS = [
  /^\/$/, // Today owns the follow-up as its Primary Action
  /^\/plans(\/|$|\?)/, // My Plans surfaces follow-ups as Needs Attention items
  /^\/onboarding/,
  /^\/auth/,
  /^\/checkin\//, // check-in + QR verification
  /^\/scan/,
  /^\/join\//,
  /^\/meetup\/.+\/summary/, // canonical follow-up surface
  /^\/meetup\/.+\/manage/, // host management/editing
  /^\/meetup-created\//,
  /^\/\.lovable\/oauth/,
  /^\/search(\/|$|\?)/, // Search is an intentional task surface
  /^\/host(\/|$|\?)/, // Host creation form
  /^\/settings/, // Settings, feedback, account deletion
  /^\/safety/, // Safety / reporting flows
  /^\/you\/edit/, // Profile editing
  /^\/dm\//, // Direct chats
  /^\/chat\//, // Meetup chat
  /^\/owner\//, // Owner operations
];

/** WO-090 §11/§13 — one bounded retry, then we stop. Never an infinite replay. */
const MAX_ATTEMPTS = 2;

async function withBoundedRetry(fn: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      // Deterministic (non-retryable) failures are not retried at all.
      if (attempt === MAX_ATTEMPTS || !isRetryableRead(error)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastError;
}

export function FollowUpPrompt() {
  const { session, profile, loading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileId = profile?.id ?? null;
  const suppressed = SUPPRESS.some((r) => r.test(pathname));

  // WO-090 §25/§26 — session-local suppression is keyed by actor, so a new
  // account can never inherit the previous member's dismissal state.
  const [dismissedInSession, setDismissedInSession] = useState<
    Record<string, Set<string>>
  >({});
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Sign out / account switch clears all client-side follow-up state.
    if (!session || !profileId) {
      setDismissedInSession({});
      shown.current = new Set();
    }
  }, [session, profileId]);

  // WO-090 §6/§7 — one shared, actor-scoped query. Route suppression disables
  // the query entirely, and the generous staleTime means ordinary navigation
  // does not re-request eligibility on every route change.
  const query = useQuery({
    queryKey: ["pending-follow-up", profileId],
    enabled: !loading && !!session && !!profileId && !suppressed,
    queryFn: fetchPendingFollowUp,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  useEffect(() => {
    if (query.error) {
      logOperationalFailure("read", {
        operation: "follow_up_pending_read",
        surface: "follow_up_prompt",
        error: query.error,
      });
    }
  }, [query.error]);

  const pending = query.data ?? null;
  const sessionDismissed =
    !!pending && !!profileId && !!dismissedInSession[profileId]?.has(pending.meetupId);

  // §9 — never render before eligibility resolves, and never while suppressed.
  const open = !!pending && !suppressed && !sessionDismissed && !query.isPending;

  useEffect(() => {
    if (!open || !pending) return;
    if (shown.current.has(pending.meetupId)) return;
    shown.current.add(pending.meetupId);
    logAnalyticsEvent("follow_up_prompt_shown", { meetup_id: pending.meetupId });
  }, [open, pending]);

  function suppressLocally(meetupId: string) {
    if (!profileId) return;
    setDismissedInSession((prev) => {
      const next = { ...prev };
      const set = new Set(next[profileId] ?? []);
      set.add(meetupId);
      next[profileId] = set;
      return next;
    });
  }

  // §10 — "viewed" means the member opened the follow-up surface, never a mere
  // render. The write happens exactly once per open, is idempotent server-side,
  // and a failure never blocks navigation or loops.
  const view = useMutation({
    mutationFn: (meetupId: string) =>
      withBoundedRetry(() => markFollowUpViewed(meetupId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-follow-up", profileId] });
    },
    onError: (error) => {
      logOperationalFailure("mutation", {
        operation: "follow_up_view_write",
        surface: "follow_up_prompt",
        error,
      });
    },
  });

  // §13/§14 — dismissal is permanent per Meetup. The mutation is idempotent, so
  // the single bounded retry is safe. If persistence still fails we tell the
  // member the truth: the prompt is hidden for now and may return later.
  const dismiss = useMutation({
    mutationFn: (meetupId: string) =>
      withBoundedRetry(() => dismissFollowUp(meetupId)),
    onSuccess: (_data, meetupId) => {
      logAnalyticsEvent("follow_up_dismissed", { meetup_id: meetupId });
      qc.invalidateQueries({ queryKey: ["pending-follow-up", profileId] });
    },
    onError: (error) => {
      logOperationalFailure("mutation", {
        operation: "follow_up_dismiss_write",
        surface: "follow_up_prompt",
        error,
      });
      toast({
        title: "Hidden for now",
        description:
          "We couldn't save that just yet, so we may ask about this Meetup again later.",
      });
    },
  });

  if (!pending) return null;

  function handleView() {
    const meetupId = pending!.meetupId;
    suppressLocally(meetupId);
    logAnalyticsEvent("follow_up_opened", { meetup_id: meetupId });
    if (!view.isPending) view.mutate(meetupId);
    navigate(`/meetup/${meetupId}/summary`);
  }

  function handleDismiss() {
    const meetupId = pending!.meetupId;
    if (dismiss.isPending) return; // §14 rapid double tap = one logical dismissal
    suppressLocally(meetupId);
    dismiss.mutate(meetupId);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : handleDismiss())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">How was {pending.title}?</DialogTitle>
          <DialogDescription>
            Take a moment to reflect and see who you met.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <SecondaryButton onClick={handleDismiss}>Not now</SecondaryButton>
          <PrimaryButton onClick={handleView}>View Meetup Summary</PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
