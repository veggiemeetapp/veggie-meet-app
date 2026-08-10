import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { AppHeader, Card, BackButton } from "@/components/app";
import { Button } from "@/components/ui/button";
import { safeBack } from "@/lib/navigation";
import { logAnalyticsEvent } from "@/lib/analytics";
import { showErrorToast } from "@/lib/errorToast";
import { logOperationalFailure } from "@/lib/opsTelemetry";
import {
  FEEDBACK_STATUS_LABEL,
  fetchBetaFeedbackQueue,
  fetchBetaHealth,
  fetchIntegrityHealth,
  fetchOperationalFailures,
  updateBetaFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/betaFeedback";

/**
 * WO-089 — owner-only private beta operations.
 *
 * Read-only aggregates plus feedback triage. Every payload here comes from an
 * owner-gated SECURITY DEFINER RPC that returns counts and bounded dimensions
 * only: no member content, no coordinates, no raw backend errors. The route is
 * additionally wrapped by RequireOwner (WO-082).
 */
const FILTERS: { id: FeedbackStatus | "all"; label: string }[] = [
  { id: "new", label: "New" },
  { id: "reviewing", label: "Reviewing" },
  { id: "planned", label: "Planned" },
  { id: "resolved", label: "Resolved" },
  { id: "wont_fix", label: "Won't fix" },
  { id: "all", label: "All" },
];

const NEXT: FeedbackStatus[] = ["reviewing", "planned", "resolved", "wont_fix"];

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 rounded-2xl bg-card border border-border">
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className="text-lg font-semibold text-charcoal">{value}</div>
    </div>
  );
}

export default function OwnerBetaOperations() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FeedbackStatus | "all">("new");

  useEffect(() => {
    logAnalyticsEvent("owner_beta_operations_opened", {});
  }, []);

  const health = useQuery({
    queryKey: ["beta-health"],
    queryFn: fetchBetaHealth,
    staleTime: 60_000,
  });
  const failures = useQuery({
    queryKey: ["beta-op-failures"],
    queryFn: () => fetchOperationalFailures(24),
    staleTime: 60_000,
  });
  const integrity = useQuery({
    queryKey: ["beta-integrity"],
    queryFn: fetchIntegrityHealth,
    staleTime: 120_000,
  });
  const queue = useQuery({
    queryKey: ["beta-feedback-queue", filter],
    queryFn: () => fetchBetaFeedbackQueue(filter === "all" ? null : filter),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (health.isError)
      logOperationalFailure("read", {
        operation: "beta_health_read",
        error: health.error,
        surface: "owner_beta_ops",
      });
  }, [health.isError, health.error]);

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: FeedbackStatus }) =>
      updateBetaFeedbackStatus(v.id, v.status),
    onSuccess: (_d, v) => {
      logAnalyticsEvent("owner_beta_feedback_status_updated", {
        status: v.status,
      });
      toast.success(`Marked ${FEEDBACK_STATUS_LABEL[v.status]}.`);
      void qc.invalidateQueries({ queryKey: ["beta-feedback-queue"] });
      void qc.invalidateQueries({ queryKey: ["beta-health"] });
    },
    onError: (e) => showErrorToast(e, { surface: "owner_beta_ops" }),
  });

  const integrityRows = Object.entries(integrity.data ?? {}).filter(
    ([k]) => k.endsWith("_issues") || k.endsWith("_users"),
  );
  const integrityClean = integrityRows.every(([, v]) => Number(v) === 0);

  return (
    <div className="flex flex-col min-h-dvh">
      <AppHeader
        title="Beta operations"
        subtitle="Owner only"
        left={
          <BackButton fallback="/settings" />
        }
        right={
          <button
            type="button"
            aria-label="Refresh"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-accent/40"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: ["beta-health"] });
              void qc.invalidateQueries({ queryKey: ["beta-op-failures"] });
              void qc.invalidateQueries({ queryKey: ["beta-integrity"] });
              void qc.invalidateQueries({ queryKey: ["beta-feedback-queue"] });
            }}
          >
            <RefreshCw className="w-5 h-5 text-charcoal" />
          </button>
        }
      />

      <div className="flex-1 px-5 py-4 space-y-6">
        <section aria-labelledby="beta-health-h">
          <h2
            id="beta-health-h"
            className="text-sm font-semibold text-charcoal flex items-center gap-2"
          >
            <Activity className="w-4 h-4 text-primary" /> Daily health
          </h2>
          {health.isError ? (
            <p className="mt-2 text-sm text-charcoal-muted">
              Health summary is unavailable right now.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="New feedback" value={health.data?.feedback_new ?? "—"} />
              <Stat
                label="Unresolved feedback"
                value={health.data?.feedback_unresolved ?? "—"}
              />
              <Stat
                label="Failures (24h)"
                value={health.data?.error_events_24h ?? "—"}
              />
              <Stat
                label="Open place reports"
                value={health.data?.open_place_reports ?? "—"}
              />
              <Stat
                label="Pending suggestions"
                value={health.data?.pending_place_suggestions ?? "—"}
              />
              <Stat
                label="Active places"
                value={health.data?.community_places_active ?? "—"}
              />
              <Stat
                label="Latest app version"
                value={health.data?.latest_app_version ?? "—"}
              />
            </div>
          )}

        </section>

        <section aria-labelledby="beta-failures-h">
          <h2
            id="beta-failures-h"
            className="text-sm font-semibold text-charcoal flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-primary" /> Top failures (24h)
          </h2>
          <div className="mt-2 space-y-2">
            {(failures.data ?? []).length === 0 ? (
              <p className="text-sm text-charcoal-muted">
                No operational failures recorded in the last 24 hours.
              </p>
            ) : (
              (failures.data ?? []).map((f) => (
                <div
                  key={`${f.event_name}-${f.fingerprint}`}
                  className="p-3 rounded-2xl bg-card border border-border"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-charcoal truncate">
                      {f.event_name}
                    </span>
                    <span className="text-xs font-semibold text-charcoal">
                      ×{f.count}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-charcoal-muted">
                    {f.surface} · {f.error_category}
                    {f.app_version ? ` · ${f.app_version}` : ""}
                  </div>
                  <div className="text-xs text-charcoal-muted">
                    last seen {new Date(f.last_seen).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section aria-labelledby="beta-integrity-h">
          <h2 id="beta-integrity-h" className="text-sm font-semibold text-charcoal">
            Data integrity
          </h2>
          <p className="mt-1 text-xs text-charcoal-muted">
            {integrity.isError
              ? "Integrity report unavailable."
              : integrityClean
                ? "All invariants clean."
                : "One or more invariants need attention."}
          </p>
          <div className="mt-2 space-y-1">
            {integrityRows
              .filter(([, v]) => Number(v) !== 0)
              .map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border text-xs"
                >
                  <span className="text-charcoal">{k.replace(/_/g, " ")}</span>
                  <span className="font-semibold text-charcoal">{String(v)}</span>
                </div>
              ))}
          </div>
        </section>

        <section aria-labelledby="beta-feedback-h">
          <h2 id="beta-feedback-h" className="text-sm font-semibold text-charcoal">
            Feedback queue
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 min-h-11 rounded-full text-xs font-medium border ${
                  filter === f.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-charcoal border-border"
                }`}
              >
                {f.label}
                {f.id !== "all" && queue.data?.counts?.[f.id as FeedbackStatus]
                  ? ` (${queue.data.counts[f.id as FeedbackStatus]})`
                  : ""}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-3">
            {queue.isLoading ? (
              <p className="text-sm text-charcoal-muted">Loading…</p>
            ) : (queue.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-charcoal-muted">
                Nothing in this state.
              </p>
            ) : (
              (queue.data?.items ?? []).map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                      {item.category}
                    </span>
                    <span className="text-xs text-charcoal-muted">
                      {FEEDBACK_STATUS_LABEL[item.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-charcoal whitespace-pre-wrap break-words">
                    {item.message}
                  </p>
                  <div className="mt-2 text-xs text-charcoal-muted">
                    {item.member_removed ? "Former member" : item.member_label} ·{" "}
                    {item.surface}
                    {item.route_template ? ` · ${item.route_template}` : ""}
                    {item.app_version ? ` · ${item.app_version}` : ""} ·{" "}
                    {new Date(item.created_at).toLocaleString()}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {NEXT.filter((s) => s !== item.status).map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: item.id, status: s })}
                      >
                        {FEEDBACK_STATUS_LABEL[s]}
                      </Button>
                    ))}
                  </div>
                </Card>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
