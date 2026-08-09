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
import { reportMeetup } from "@/lib/postMeetup";
import { MEETUP_REPORT_REASONS } from "@/lib/safety";
import { memberSafeMessage } from "@/lib/errors";

export function ReportMeetupDialog({
  meetupId,
  open,
  onOpenChange,
}: {
  meetupId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [reason, setReason] = useState<string>(MEETUP_REPORT_REASONS[0].label);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await reportMeetup(meetupId, reason, details.trim() || null);
      toast.success("Report received", {
        description: "Thank you. Our team will review this privately.",
      });
      onOpenChange(false);
      setDetails("");
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this Meetup</DialogTitle>
          <DialogDescription>
            Your report is private and reviewed by our team. The host is not notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-charcoal">Reason</label>
            <div role="radiogroup" className="mt-1 space-y-1.5">
              {MEETUP_REPORT_REASONS.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm cursor-pointer hover:bg-muted"
                >
                  <input
                    type="radio"
                    name="report-meetup-reason"
                    value={r.label}
                    checked={reason === r.label}
                    onChange={() => setReason(r.label)}
                    className="accent-primary"
                  />
                  <span className="text-charcoal">{r.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-charcoal">
              Details{" "}
              <span className="text-charcoal-muted font-normal">Optional</span>
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              rows={4}
              className="mt-1 w-full rounded-2xl border border-border p-3 text-sm bg-background resize-none"
              placeholder="Share anything that will help our team review this."
            />
            <p className="mt-1 text-[11px] text-charcoal-muted">
              {details.length}/1000
            </p>
          </div>
        </div>
        <DialogFooter>
          <SecondaryButton onClick={() => onOpenChange(false)}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
