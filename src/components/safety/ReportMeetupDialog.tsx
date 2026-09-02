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
import { useUnsavedWork } from "@/lib/unsavedWork";
import {
  describeReportError,
  REPORT_DETAILS_MAX,
  type ReportErrorInfo,
} from "@/lib/reportSubmission";

/**
 * WO-140 — the radio value is the *canonical reason code* (`r.id`), which is
 * what `public.report_meetup` validates. Sending the display label made every
 * submission fail with "Invalid reason".
 */
export function ReportMeetupDialog({
  meetupId,
  open,
  onOpenChange,
}: {
  meetupId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [reasonCode, setReasonCode] = useState<string>(MEETUP_REPORT_REASONS[0].id);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReportErrorInfo | null>(null);

  // WO-145B: an open report with member-entered content is protected work.
  useUnsavedWork("report-meetup", "report_form", open && (busy || details.trim().length > 0));

  async function submit() {
    // Double-submit guard: a second click while a submission is in flight is a
    // no-op, so a rapid double tap can never create two reports.
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await reportMeetup(meetupId, reasonCode, details.trim() || null);
      toast.success("Report received", {
        description: "Thank you. Our team will review this privately.",
      });
      // Success only: close and reset. On failure the reason and details are
      // deliberately preserved so the member can retry without retyping.
      onOpenChange(false);
      setReasonCode(MEETUP_REPORT_REASONS[0].id);
      setDetails("");
    } catch (e) {
      const info = describeReportError(e);
      setFailure(info);
      toast.error(info.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this Meetup</DialogTitle>
          <DialogDescription>
            Your report is private and reviewed by our team. The host is not notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-charcoal" id="report-meetup-reason-label">
              Reason
            </label>
            <div
              role="radiogroup"
              aria-labelledby="report-meetup-reason-label"
              className="mt-1 space-y-1.5"
            >
              {MEETUP_REPORT_REASONS.map((r) => (
                <label
                  key={r.id}
                  className="flex min-h-[44px] items-center gap-2 rounded-control border border-border p-2.5 text-sm cursor-pointer hover:bg-muted"
                >
                  <input
                    type="radio"
                    name="report-meetup-reason"
                    value={r.id}
                    checked={reasonCode === r.id}
                    onChange={() => setReasonCode(r.id)}
                    className="accent-primary"
                  />
                  <span className="text-charcoal">{r.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-charcoal" htmlFor="report-meetup-details">
              Details{" "}
              <span className="text-charcoal-muted font-normal">Optional</span>
            </label>
            <textarea
              id="report-meetup-details"
              aria-label="What happened? (optional)"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, REPORT_DETAILS_MAX))}
              rows={4}
              className="mt-1 w-full rounded-card border border-border p-3 text-sm bg-background resize-none"
              placeholder="Share anything that will help our team review this."
            />
            <p className="mt-1 text-[11px] text-charcoal-muted">
              {details.length}/{REPORT_DETAILS_MAX}
            </p>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <SecondaryButton onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </SecondaryButton>
          <PrimaryButton onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
