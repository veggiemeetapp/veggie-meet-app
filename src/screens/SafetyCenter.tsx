import { safeBack } from "@/lib/navigation";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Flag,
  LifeBuoy,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  UserX,
} from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  fetchBlockedProfiles,
  fetchMyReportDetail,
  fetchMyReports,
  reasonLabel,
  SAFETY_REASONS,
  statusLabel,
  submitSafetyReport,
  unblockProfile,
  type BlockedProfile,
  type MyReportDetail,
  type MyReportRow,
  type PublicReportStatus,
} from "@/lib/safety";

export default function SafetyCenter() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const blocksQuery = useQuery({
    queryKey: ["safety", "blocks"],
    queryFn: fetchBlockedProfiles,
  });

  const reportsQuery = useQuery({
    queryKey: ["safety", "reports"],
    queryFn: fetchMyReports,
  });

  const [unblockTarget, setUnblockTarget] = useState<BlockedProfile | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [detailReport, setDetailReport] = useState<MyReportRow | null>(null);

  return (
    <>
      <AppHeader
        title="Safety & Trust"
        subtitle="Manage your safety, privacy, blocks, and reports."
        left={
          <button
            onClick={() => safeBack(navigate, "/settings")}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5 text-charcoal" />
          </button>
        }
      />

      <div className="px-5 mt-2 pb-10 space-y-6">
        {/* Your safety */}
        <Card padding="lg" className="space-y-4 bg-soft-green/40 border-primary/10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-charcoal">Your safety</h2>
          </div>
          <p className="text-sm text-charcoal leading-relaxed">
            You are always in control of who can contact you and how you participate in the community.
          </p>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton size="sm" onClick={() => setSafetyOpen(true)}>
              <Flag className="w-4 h-4" /> Report a safety concern
            </SecondaryButton>
          </div>
        </Card>

        {/* Blocked Veggies */}
        <Section
          title="Blocked Veggies"
          hint={blocksQuery.data ? `${blocksQuery.data.length} blocked` : undefined}
        >
          {blocksQuery.isLoading ? (
            <Card className="h-24 animate-pulse" />
          ) : (blocksQuery.data ?? []).length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon={<UserX className="w-6 h-6" />}
                title="No blocked Veggies"
                description="People you block will appear here."
              />
            </Card>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-border/60">
                {(blocksQuery.data ?? []).map((b) => (
                  <li key={b.blockId} className="flex items-center gap-3 px-4 py-3">
                    <UserAvatar name={b.displayName} src={b.avatarUrl ?? undefined} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">
                        {firstName(b.displayName)}
                      </p>
                      <p className="text-[11px] text-charcoal-muted">
                        Blocked {formatDate(b.blockedAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setUnblockTarget(b)}
                      className="text-charcoal-muted"
                    >
                      Unblock
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>

        {/* Your reports */}
        <Section title="Your reports">
          {reportsQuery.isLoading ? (
            <Card className="h-24 animate-pulse" />
          ) : (reportsQuery.data ?? []).length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon={<FileText className="w-6 h-6" />}
                title="No reports submitted"
                description="Reports you submit will appear here."
              />
            </Card>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-border/60">
                {(reportsQuery.data ?? []).map((r) => (
                  <li key={`${r.subjectType}-${r.reportId}`}>
                    <button
                      onClick={() => setDetailReport(r)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
                    >
                      <div
                        className={cn(
                          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                          "bg-soft-green text-primary",
                        )}
                      >
                        {r.subjectType === "meetup" ? (
                          <MapPin className="w-4 h-4" />
                        ) : r.subjectType === "safety_concern" ? (
                          <ShieldCheck className="w-4 h-4" />
                        ) : (
                          <UserX className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-charcoal truncate">
                          {subjectTypeLabel(r.subjectType)}
                        </p>
                        <p className="text-xs text-charcoal-muted truncate">
                          {r.subjectLabel} · {formatDate(r.createdAt)}
                        </p>
                      </div>
                      <StatusPill status={r.publicStatus} />
                      <ChevronRight className="w-4 h-4 text-charcoal-muted shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>

        {/* Meeting safely */}
        <Section title="Meeting safely">
          <Card padding="lg" className="space-y-3">
            <SafetyTip>Meet in public places you know.</SafetyTip>
            <SafetyTip>Tell a friend where you’re going.</SafetyTip>
            <SafetyTip>Arrange your own transportation.</SafetyTip>
            <SafetyTip>Keep personal info private until you feel comfortable.</SafetyTip>
            <SafetyTip>Leave whenever something feels off — trust your judgment.</SafetyTip>
            <SafetyTip>Report harassment, discrimination, or threatening behavior.</SafetyTip>
          </Card>
        </Section>

        {/* Emergency */}
        <Section title="If you need immediate help">
          <Card padding="lg" className="border-destructive/20 bg-destructive/5">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <LifeBuoy className="w-5 h-5" />
              </div>
              <div className="text-sm text-charcoal leading-relaxed">
                <p className="font-semibold">If you are in immediate danger, contact local emergency services.</p>
                <p className="text-charcoal-muted mt-1">
                  VeggieMeet is not a substitute for emergency help. Please reach out to
                  the appropriate emergency number in your country.
                </p>
              </div>
            </div>
          </Card>
        </Section>

        {/* Privacy explanations */}
        <Section title="Privacy & support">
          <Card padding="none">
            <ul className="divide-y divide-border/60">
              <FAQ
                q="What happens when I block someone?"
                a="They can’t message, invite, verify with you, or find you in recommendations. They aren’t notified."
              />
              <FAQ
                q="What happens when I report someone?"
                a="Our team reviews what you shared. Reports are private and don’t automatically block the other person."
              />
              <FAQ
                q="Can someone see that I reported them?"
                a="No. Reports remain private from the person you report."
              />
              <FAQ
                q="Can someone see that I blocked them?"
                a="No. Blocks aren’t announced. For privacy we may not share moderation details."
              />
            </ul>
          </Card>
        </Section>
      </div>

      {/* Unblock confirmation */}
      <Dialog open={!!unblockTarget} onOpenChange={(o) => !o && setUnblockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Unblock {unblockTarget ? firstName(unblockTarget.displayName) : ""}?
            </DialogTitle>
            <DialogDescription>
              They may be able to find and contact you again, depending on your relationship status.
              Existing conversations and invitations won’t be restored automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUnblockTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!unblockTarget) return;
                try {
                  await unblockProfile(unblockTarget.profileId);
                  toast.success(`${firstName(unblockTarget.displayName)} unblocked.`);
                  qc.invalidateQueries({ queryKey: ["safety", "blocks"] });
                } catch {
                  toast.error("We couldn’t complete that action.");
                } finally {
                  setUnblockTarget(null);
                }
              }}
            >
              Unblock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safety concern report */}
      <SafetyConcernDialog
        open={safetyOpen}
        onOpenChange={setSafetyOpen}
        onSubmitted={() => qc.invalidateQueries({ queryKey: ["safety", "reports"] })}
      />

      {/* Report detail */}
      <ReportDetailDialog
        row={detailReport}
        onOpenChange={(o) => !o && setDetailReport(null)}
      />
    </>
  );
}

/* ------ Building blocks ------ */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="px-1 mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-charcoal-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function SafetyTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-charcoal leading-relaxed">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <li className="px-4 py-3">
      <p className="text-sm font-semibold text-charcoal flex items-start gap-2">
        <Lock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        {q}
      </p>
      <p className="text-xs text-charcoal-muted mt-1 leading-relaxed pl-6">{a}</p>
    </li>
  );
}

function StatusPill({ status }: { status: PublicReportStatus }) {
  const styles =
    status === "resolved"
      ? "bg-soft-green text-primary"
      : status === "under_review"
      ? "bg-host-badge/15 text-host-badge"
      : "bg-muted text-charcoal-muted";
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", styles)}>
      {statusLabel(status)}
    </span>
  );
}

function subjectTypeLabel(t: MyReportRow["subjectType"]): string {
  return t === "profile" ? "Veggie report" : t === "meetup" ? "Meetup report" : "Safety concern";
}

function firstName(name: string) {
  return name.split(" ")[0] || name;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/* ------ Safety concern dialog ------ */

function SafetyConcernDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState<string>(SAFETY_REASONS[0].id);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setReason(SAFETY_REASONS[0].id);
          setDetails("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a safety concern</DialogTitle>
          <DialogDescription>
            Your report is private from anyone it involves. Share what feels safe to share.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={setReason} className="gap-2">
          {SAFETY_REASONS.map((r) => (
            <Label
              key={r.id}
              htmlFor={`safety-${r.id}`}
              className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2 cursor-pointer hover:bg-muted/50"
            >
              <RadioGroupItem id={`safety-${r.id}`} value={r.id} />
              <span className="text-sm">{r.label}</span>
            </Label>
          ))}
        </RadioGroup>
        <Textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
          rows={4}
          placeholder="Add details (optional)"
          className="resize-none"
        />
        <div className="text-[11px] text-charcoal-muted text-right">
          {details.length}/1000
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await submitSafetyReport({ reason, details: details.trim() || null });
                toast.success("Report submitted.");
                onSubmitted();
                onOpenChange(false);
              } catch {
                toast.error("We couldn’t submit that report.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------ Report detail dialog ------ */

function ReportDetailDialog({
  row,
  onOpenChange,
}: {
  row: MyReportRow | null;
  onOpenChange: (o: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["safety", "report", row?.subjectType, row?.reportId],
    enabled: !!row,
    queryFn: () => fetchMyReportDetail(row!.subjectType, row!.reportId),
  });
  const d: MyReportDetail | undefined = query.data;
  const displayed = useMemo(() => d ?? (row ? rowToDetail(row) : null), [d, row]);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        {displayed && (
          <>
            <DialogHeader>
              <DialogTitle>{subjectTypeLabel(displayed.subjectType)}</DialogTitle>
              <DialogDescription>
                {displayed.subject?.display_name || displayed.subject?.title || "General safety concern"} ·{" "}
                {formatDate(displayed.createdAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-charcoal">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
                  Reason
                </p>
                <p className="mt-1">{reasonLabel(displayed.reason)}</p>
              </div>
              {displayed.details && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
                    Details you shared
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{displayed.details}</p>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
                  Status
                </p>
                <div className="mt-1">
                  <StatusPill status={displayed.publicStatus} />
                </div>
              </div>
              <p className="text-xs text-charcoal-muted leading-relaxed">
                We’ll review the information you shared. For privacy, we may not be able to
                provide details about actions involving another person.
              </p>
            </div>
            <DialogFooter>
              <PrimaryButton size="sm" onClick={() => onOpenChange(false)}>
                Close
              </PrimaryButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function rowToDetail(r: MyReportRow): MyReportDetail {
  return {
    subjectType: r.subjectType,
    reportId: r.reportId,
    reason: r.reason,
    details: r.details,
    publicStatus: r.publicStatus,
    createdAt: r.createdAt,
    subject: { id: r.subjectId, title: r.subjectLabel, display_name: r.subjectLabel },
  };
}
