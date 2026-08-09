import { safeBack } from "@/lib/navigation";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { AppHeader, Card } from "@/components/app";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchMemberReportQueue,
  setMemberReportStatus,
  MEMBER_REPORT_STATUS_LABEL,
  type MemberReportStatus,
} from "@/lib/safety";

const FILTERS: { id: MemberReportStatus | "all"; label: string }[] = [
  { id: "submitted", label: "Submitted" },
  { id: "under_review", label: "Under review" },
  { id: "resolved", label: "Resolved" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

const CHIP: Record<MemberReportStatus, string> = {
  submitted: "bg-muted text-charcoal-muted",
  under_review: "bg-soft-green text-primary",
  resolved: "bg-soft-green text-primary",
  dismissed: "bg-muted text-charcoal-muted",
};

export default function OwnerMemberReports() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<MemberReportStatus | "all">("submitted");

  const q = useQuery({
    queryKey: ["member-report-queue", filter],
    queryFn: () => fetchMemberReportQueue(filter === "all" ? null : filter),
    enabled: !!profile,
  });

  const m = useMutation({
    mutationFn: (v: { id: string; status: MemberReportStatus }) =>
      setMemberReportStatus(v.id, v.status),
    onSuccess: () => {
      toast.success("Report updated");
      qc.invalidateQueries({ queryKey: ["member-report-queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const counts = q.data?.counts;

  return (
    <>
      <AppHeader
        left={
          <button
            type="button"
            onClick={() => safeBack(navigate, "/owner/places")}
            aria-label="Go back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        }
        title="Member reports"
      />

      <main className="px-4 pb-24 pt-2 space-y-4">
        {counts ? (
          <Card className="p-4">
            <p className="text-sm text-charcoal-muted">
              {counts.submitted ?? 0} submitted · {counts.under_review ?? 0} under review ·{" "}
              {counts.resolved ?? 0} resolved · {counts.dismissed ?? 0} dismissed
            </p>
          </Card>
        ) : null}

        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Report status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                filter === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-charcoal"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {q.isError ? (
          <Card className="p-4 text-sm text-charcoal-muted">
            This queue is available to the VeggieMeet team only.
          </Card>
        ) : q.isLoading ? (
          <Card className="p-4 text-sm text-charcoal-muted">Loading…</Card>
        ) : items.length === 0 ? (
          <Card className="p-6 text-center space-y-2">
            <ShieldAlert className="w-6 h-6 mx-auto text-charcoal-muted" />
            <p className="text-sm text-charcoal-muted">No reports in this view.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((r) => (
              <li key={r.report_id}>
                <Card className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-charcoal break-words">{r.reason}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${CHIP[r.status]}`}>
                      {MEMBER_REPORT_STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <p className="text-xs text-charcoal-muted break-words">
                    {r.reporter.display_name} reported {r.reported.display_name} ·{" "}
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                  {r.details ? (
                    <p className="text-sm text-charcoal whitespace-pre-wrap break-words">{r.details}</p>
                  ) : null}
                  {r.message_snapshot ? (
                    <p className="rounded-xl bg-muted p-2.5 text-xs text-charcoal-muted whitespace-pre-wrap break-words">
                      “{r.message_snapshot}”
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(["under_review", "resolved", "dismissed"] as MemberReportStatus[])
                      .filter((s) => s !== r.status)
                      .map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant="outline"
                          disabled={m.isPending}
                          onClick={() => m.mutate({ id: r.report_id, status: s })}
                        >
                          Mark {MEMBER_REPORT_STATUS_LABEL[s].toLowerCase()}
                        </Button>
                      ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
