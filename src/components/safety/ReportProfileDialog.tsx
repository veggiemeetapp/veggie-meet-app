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
import { PROFILE_REPORT_REASONS, submitProfileReport, blockProfile } from "@/lib/safety";
import { logAnalyticsEvent } from "@/lib/analytics";
import { memberSafeMessage } from "@/lib/errors";


type Step = "form" | "offer_block";

export function ReportProfileDialog({
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
  const [step, setStep] = useState<Step>("form");
  const [reason, setReason] = useState<string>(PROFILE_REPORT_REASONS[0].label);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("form");
    setReason(PROFILE_REPORT_REASONS[0].label);
    setDetails("");
    setBusy(false);
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await submitProfileReport({
        reportedProfileId: profileId,
        reason,
        details: details.trim() || null,
      });
      logAnalyticsEvent("member_reported", { reason_provided: true, has_details: !!details.trim() });
      toast.success("Report received", {
        description: "Thank you. Our team will review this privately.",
      });
      setStep("offer_block");
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function blockNow() {
    if (busy) return;
    setBusy(true);
    try {
      const out = await blockProfile(profileId);
      logAnalyticsEvent("member_blocked", { result: out.result, source: "report_flow" });
      toast.success(`${displayName} has been blocked.`);
      onBlocked?.();
      close(false);
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setBusy(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Report {displayName}</DialogTitle>
              <DialogDescription>
                Your report is private and reviewed by our team. {displayName} is not notified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-charcoal">Reason</label>
                <div role="radiogroup" className="mt-1 space-y-1.5">
                  {PROFILE_REPORT_REASONS.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm cursor-pointer hover:bg-muted"
                    >
                      <input
                        type="radio"
                        name="report-profile-reason"
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
                />
                <p className="mt-1 text-[11px] text-charcoal-muted">{details.length}/1000</p>
              </div>
            </div>
            <DialogFooter>
              <SecondaryButton onClick={() => close(false)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={submit} disabled={busy}>
                {busy ? "Submitting…" : "Submit report"}
              </PrimaryButton>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Also block {displayName}?</DialogTitle>
              <DialogDescription>
                Blocking is separate from reporting. If you'd like, you can also block{" "}
                {displayName} to stop all direct interaction. They will not be told.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <SecondaryButton onClick={() => close(false)}>No, thanks</SecondaryButton>
              <PrimaryButton onClick={blockNow} disabled={busy}>
                {busy ? "Blocking…" : `Block ${displayName}`}
              </PrimaryButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
