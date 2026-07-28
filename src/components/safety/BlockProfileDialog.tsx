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
      await blockProfile(profileId);
      toast.success(`${displayName} has been blocked.`);
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
