import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  fetchPlaceReportQueue,
  moderatePlaceReport,
  REPORT_REASON_LABEL,
  type OwnerPlaceReport,
  type ReportModerationAction,
  type ReportPlaceAction,
} from "@/lib/placeReports";
import { MAINTENANCE_STATUS_LABEL } from "@/lib/placeMaintenance";
import type { CommunityPlaceMaintenanceStatus } from "@/types";

const OWNER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
  duplicate: "Duplicate",
};

const PLACE_ACTIONS: Array<{ value: "" | ReportPlaceAction; label: string }> = [
  { value: "", label: "No place status change" },
  { value: "needs_reverification", label: "Mark needs reverification" },
  { value: "temporarily_closed", label: "Mark temporarily closed" },
  { value: "permanently_closed", label: "Mark permanently closed" },
];

const FAILURE_COPY: Record<string, string> = {
  owner_only: "Owner access is required.",
  report_not_found: "That report no longer exists.",
  invalid_transition: "That action isn't available for this report's current status.",
  note_required: "An internal note is required for this action.",
  invalid_input: "Check the note and the selected place action.",
  place_not_found: "That Community Place no longer exists.",
};

/**
 * WO-054 — owner-only report moderation queue.
 *
 * Every action is re-authorised server-side by is_owner(). Place status changes
 * are delegated to the WO-053 maintenance RPC inside the same transaction, so
 * this UI never writes to community_places directly.
 */
export function ReportQueue() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [placeAction, setPlaceAction] = useState<"" | ReportPlaceAction>("");
  // WO-054A: resolving with a place-status action changes the PUBLIC place, so
  // it must be confirmed explicitly with the selected action named back.
  const [confirming, setConfirming] = useState<OwnerPlaceReport | null>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);

  const q = useQuery({ queryKey: ["place-report-queue"], queryFn: fetchPlaceReportQueue });

  const moderateM = useMutation({
    mutationFn: (vars: { id: string; action: ReportModerationAction }) =>
      moderatePlaceReport({
        reportId: vars.id,
        action: vars.action,
        note,
        placeAction: vars.action === "resolve" && placeAction ? placeAction : null,
      }),
    onSuccess: (r, vars) => {
      if (!r.ok) {
        toast.error(FAILURE_COPY[r.reason] ?? "That action couldn't be completed.");
        return;
      }
      logAnalyticsEvent("community_place_report_moderated", {
        report_id: vars.id,
        action: vars.action,
        place_action: placeAction || "none",
      });
      toast.success("Report updated.");
      setNote("");
      setPlaceAction("");
      setConfirming(null);
      qc.invalidateQueries({ queryKey: ["place-report-queue"] });
      qc.invalidateQueries({ queryKey: ["maintenance-places"] });
      qc.invalidateQueries({ queryKey: ["published-places-all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <section className="min-w-0 space-y-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Member place reports</h2>
        <p className="text-xs text-muted-foreground">
          Private reports from members. Nothing changes publicly until you act here.
        </p>
      </div>

      {q.isPending ? (
        <div className="h-20 rounded-lg bg-muted animate-pulse" />
      ) : q.isError ? (
        <p className="text-xs text-destructive">Couldn't load the report queue.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No member reports yet.</p>
      ) : (
        <ul className="min-w-0 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="min-w-0 overflow-hidden rounded-lg border p-3">
              <button
                type="button"
                className="block w-full min-w-0 text-left"
                aria-expanded={openId === r.id}
                onClick={() => {
                  const next = openId === r.id ? null : r.id;
                  setOpenId(next);
                  setNote("");
                  setPlaceAction("");
                  if (next)
                    logAnalyticsEvent("community_place_report_owner_opened", { report_id: r.id });
                }}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span
                    className="min-w-0 flex-1 text-sm font-medium line-clamp-3 [overflow-wrap:anywhere]"
                    title={r.place_name}
                  >
                    {r.place_name}
                  </span>
                  <span className="text-[11px] shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    {OWNER_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {REPORT_REASON_LABEL[r.reason_code] ?? r.reason_code} ·{" "}
                  {new Date(r.created_at).toLocaleDateString()} ·{" "}
                  {MAINTENANCE_STATUS_LABEL[
                    r.place_maintenance_status as CommunityPlaceMaintenanceStatus
                  ] ?? r.place_maintenance_status}
                </p>
                {r.open_same_reason_count > 1 && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {r.open_same_reason_count} open reports for this issue
                  </p>
                )}
              </button>

              {openId === r.id && (
                <>
                  <Detail r={r} />
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <label className="text-xs font-medium" htmlFor={`place-action-${r.id}`}>
                      Place status change (applied only when resolving)
                    </label>
                    <select
                      id={`place-action-${r.id}`}
                      value={placeAction}
                      onChange={(e) => setPlaceAction(e.target.value as "" | ReportPlaceAction)}
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {PLACE_ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <Textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                      placeholder="Internal note (never shown to the reporter). Required to resolve or dismiss."
                      aria-label="Internal moderation note"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Start review of the report for ${r.place_name}`}
                        disabled={moderateM.isPending || r.status !== "pending"}
                        onClick={() => moderateM.mutate({ id: r.id, action: "start_review" })}
                      >
                        Start Review
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Mark the report for ${r.place_name} as duplicate`}
                        disabled={
                          moderateM.isPending ||
                          !(r.status === "pending" || r.status === "under_review")
                        }
                        onClick={() => moderateM.mutate({ id: r.id, action: "duplicate" })}
                      >
                        Mark Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Dismiss the report for ${r.place_name}`}
                        disabled={
                          moderateM.isPending ||
                          !(r.status === "pending" || r.status === "under_review")
                        }
                        onClick={() => moderateM.mutate({ id: r.id, action: "dismiss" })}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`Resolve the report for ${r.place_name}`}
                        disabled={
                          moderateM.isPending ||
                          !(r.status === "pending" || r.status === "under_review")
                        }
                        onClick={(e) => {
                          if (placeAction) {
                            confirmTriggerRef.current = e.currentTarget;
                            setConfirming(r);
                            return;
                          }
                          moderateM.mutate({ id: r.id, action: "resolve" });
                        }}
                      >
                        {moderateM.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          "Resolve"
                        )}
                      </Button>
                    </div>
                    {/* WO-057 — correct wrong public details for this place. */}
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit the public details of ${r.place_name}`}
                      onClick={() =>
                        navigate(
                          `/owner/places/${r.community_place_id}/edit?from=member_report&report=${r.id}`,
                        )
                      }
                    >
                      Edit public details
                    </Button>
                    {/* WO-058 — a vegan-status report can only trigger a review, never change status. */}
                    {r.reason_code === "vegan_status_concern" && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Review the vegan status of ${r.place_name}`}
                        onClick={() =>
                          navigate(
                            `/owner/places/${r.community_place_id}/vegan-review?source=member_report&report=${r.id}`,
                          )
                        }
                      >
                        Review vegan status
                      </Button>
                    )}

                    <p className="text-[11px] text-muted-foreground">
                      The reporter is notified of the outcome only. Internal notes, your identity,
                      and other members' reports are never shared. Editing public details never
                      resolves this report.
                    </p>

                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!confirming}
        onOpenChange={(o) => {
          if (!o && !moderateM.isPending) {
            const label = confirming
              ? `Resolve the report for ${confirming.place_name}`
              : null;
            setConfirming(null);
            // Radix restores focus to its own trigger on close; this dialog is
            // opened programmatically, so put focus back on the Resolve button
            // that opened it (re-queried, since the row may have re-rendered).
            setTimeout(() => {
              const el =
                confirmTriggerRef.current?.isConnected
                  ? confirmTriggerRef.current
                  : label
                    ? (document.querySelector(
                        `button[aria-label="${label.replace(/"/g, '\\"')}"]`,
                      ) as HTMLElement | null)
                    : null;
              el?.focus();
            }, 0);
          }
        }}
      >
        <AlertDialogContent className="max-w-[min(92vw,32rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              Resolve this report and change the public place status?
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              Two things will happen together:
              <span className="mt-2 block">
                1. The member's report is marked <strong>Resolved</strong>. They are told the
                outcome only — never your internal note.
              </span>
              <span className="mt-1 block">
                2. <strong>{confirming?.place_name}</strong> is publicly set to{" "}
                <strong>
                  {PLACE_ACTIONS.find((a) => a.value === placeAction)?.label ?? "no change"}
                </strong>
                . Every member browsing VeggieMeet sees this change.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moderateM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={moderateM.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirming) moderateM.mutate({ id: confirming.id, action: "resolve" });
              }}
            >
              {moderateM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                "Resolve and change status"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Detail({ r }: { r: OwnerPlaceReport }) {
  return (
    <dl className="mt-3 min-w-0 space-y-2 text-xs">
      <Row label="What the member reported" value={r.explanation} />
      {r.official_source_url && (
        <div className="min-w-0">
          <dt className="font-medium">Source link</dt>
          <dd className="mt-0.5 min-w-0">
            <a
              href={r.official_source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="block max-w-full [overflow-wrap:anywhere] break-words text-primary underline"
            >
              {r.official_source_url}
              <ExternalLink className="ml-1 inline h-3 w-3 shrink-0 align-baseline" aria-hidden />
            </a>
          </dd>
        </div>
      )}
      {r.additional_details && <Row label="Additional details" value={r.additional_details} />}
      {r.owner_resolution && <Row label="Recorded outcome" value={r.owner_resolution} />}
      <Row label="Reporter profile" value={r.reporter_profile_id} />
      {r.resolved_at && <Row label="Actioned at" value={new Date(r.resolved_at).toLocaleString()} />}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium">{label}</dt>
      <dd className="mt-0.5 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-muted-foreground">
        {value}
      </dd>
    </div>
  );
}
