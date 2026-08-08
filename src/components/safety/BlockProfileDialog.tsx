import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PrimaryButton, SecondaryButton } from "@/components/app";
import { blockProfile } from "@/lib/safety";
import { logAnalyticsEvent } from "@/lib/analytics";


export function BlockProfileDialog({
  profileId,
  displayName,
  open,
  onOpenChange,
  onBlocked,
}: {
  profileId: string;
  displayName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onBlocked?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const out = await blockProfile(profileId);
      logAnalyticsEvent("member_blocked", {
        result: out.result,
        neutralized_requests: out.neutralized_requests ?? 0,
        neutralized_invitations: out.neutralized_invitations ?? 0,
        cancelled_attendance: out.cancelled_attendance ?? 0,
      });
      toast.success(`${displayName} has been blocked.`, {
        description:
          (out.cancelled_attendance ?? 0) > 0 || (out.neutralized_requests ?? 0) > 0
            ? "Pending requests, invitations and shared upcoming Meetups were cleared."
            : undefined,
      });
      onBlocked?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Block failed");
    } finally {
      setBusy(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block {displayName}?</DialogTitle>
          <DialogDescription>
            {displayName} will not be told. You can unblock later from the Safety & Trust Center.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-muted p-3 text-sm text-charcoal space-y-1.5">
          <p className="font-semibold">Blocking will prevent:</p>
          <ul className="list-disc pl-5 space-y-0.5 text-charcoal-muted">
            <li>Connection requests in either direction</li>
            <li>Direct messages in either direction</li>
            <li>Meetup invitations in either direction</li>
            <li>QR check-in verification between you</li>
            <li>Recommendations of each other</li>
          </ul>
        </div>
        <DialogFooter>
          <SecondaryButton onClick={() => onOpenChange(false)}>Cancel</SecondaryButton>
          <PrimaryButton onClick={confirm} disabled={busy}>
            {busy ? "Blocking…" : `Block ${displayName}`}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
