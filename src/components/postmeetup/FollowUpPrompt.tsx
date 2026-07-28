import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import {
  dismissFollowUp,
  fetchPendingFollowUp,
  markFollowUpViewed,
} from "@/lib/postMeetup";

// Routes where we won't interrupt the user with the follow-up prompt.
// The prompt may appear on passive landing/discovery surfaces, but never
// while the user is completing a focused form, safety action, account
// action, or canonical follow-up task.
const SUPPRESS = [
  /^\/$/, // Today owns the follow-up as its Primary Action
  /^\/plans(\/|$|\?)/, // My Plans surfaces follow-ups as Needs Attention items
  /^\/onboarding/,
  /^\/checkin\//,
  /^\/meetup\/.+\/summary/,
  /^\/meetup\/.+\/manage/, // Host management/editing
  /^\/\.lovable\/oauth/,
  /^\/search(\/|$|\?)/, // Search is an intentional task surface
  /^\/host(\/|$|\?)/, // Host creation form
  /^\/settings/, // Settings and all subsections
  /^\/safety/, // Safety / reporting flows
  /^\/you\/edit/, // Profile editing
  /^\/dm\//, // Direct chats
  /^\/chat\//, // Meetup chat
];

export function FollowUpPrompt() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const suppressed = SUPPRESS.some((r) => r.test(pathname));
  const [open, setOpen] = useState(false);
  const [dismissedInSession, setDismissedInSession] = useState<Set<string>>(
    new Set(),
  );

  const query = useQuery({
    queryKey: ["pending-follow-up", profile?.id],
    enabled: !!profile?.id && !suppressed,
    queryFn: () => fetchPendingFollowUp(profile!.id),
    staleTime: 60_000,
  });

  const pending = query.data ?? null;

  useEffect(() => {
    if (!pending || suppressed) return;
    if (dismissedInSession.has(pending.meetupId)) return;
    setOpen(true);
  }, [pending, suppressed, dismissedInSession]);

  if (!pending) return null;

  async function handleView() {
    setOpen(false);
    try {
      await markFollowUpViewed(pending.meetupId);
    } catch {}
    navigate(`/meetup/${pending.meetupId}/summary`);
  }

  async function handleDismiss() {
    setOpen(false);
    setDismissedInSession((s) => new Set(s).add(pending.meetupId));
    try {
      await dismissFollowUp(pending.meetupId);
    } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleDismiss())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How was {pending.title}?</DialogTitle>
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
