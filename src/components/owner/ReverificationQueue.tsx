import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  RESULT_LABEL,
  STATE_LABEL,
  STATE_TONE,
  daysSince,
  fetchReverificationQueue,
  formatDate,
  startReverification,
} from "@/lib/placeReverification";
import { MAINTENANCE_STATUS_LABEL } from "@/lib/placeMaintenance";
import type { CommunityPlaceMaintenanceStatus } from "@/types";

/** Module-scoped guard so the queue-open event fires once per session. */
const queueOpenedOnce = new Set<string>();

const CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian friendly",
  vegan_options: "Vegan options",
  not_food: "Community space",
};

/**
 * WO-056 — Owner-only Community Place reverification queue.
 *
 * Presentation only. Freshness is computed server-side from the existing
 * verification dates; age alone never hides a place or removes a badge. Internal
 * notes are never rendered on a collapsed card.
 */
export function ReverificationQueue() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const queueQ = useQuery({
    queryKey: ["place-reverification-queue"],
    queryFn: fetchReverificationQueue,
    // Owner-only surface; one queue-open event per mount.
    meta: undefined,
  });

  // Fire the queue-open analytics event once data is available.
  const opened = queueQ.isSuccess;
  if (opened && !queueOpenedOnce.has("q")) {
    queueOpenedOnce.add("q");
    logAnalyticsEvent("community_place_reverification_queue_opened");
  }

  const startM = useMutation({
    mutationFn: (placeId: string) => startReverification(placeId),
    onSuccess: (r, placeId) => {
      if (!r.duplicate) {
        logAnalyticsEvent("community_place_reverification_started", { place_id: placeId });
      }
      qc.invalidateQueries({ queryKey: ["place-reverification-queue"] });
      qc.invalidateQueries({ queryKey: ["place-reverification-workspace", placeId] });
      toast.success(
        r.duplicate
          ? "This place already has an open reverification. Opening it."
          : "Reverification started. Nothing public changed.",
      );
      navigate(`/owner/places/${placeId}/reverify`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Place reverification
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">
          Regularly confirm that published places are still open, accurate, and 100% vegan.
        </p>
      </div>

      <p aria-live="polite" className="sr-only">
        {queueQ.isSuccess ? `${queueQ.data.length} published places in the reverification queue.` : ""}
      </p>

      {queueQ.isLoading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading queue…
        </p>
      )}
      {queueQ.isError && (
        <p className="text-sm text-destructive">
          Could not load the reverification queue. {(queueQ.error as Error).message}
        </p>
      )}
      {queueQ.isSuccess && queueQ.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No published places yet.</p>
      )}

      <ul className="space-y-2">
        {(queueQ.data ?? []).map((p) => {
          const baseline = p.last_reverified_at ?? p.verified_at;
          const age = daysSince(baseline);
          return (
            <li key={p.id} className="rounded-lg border p-3 min-w-0">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2 [overflow-wrap:anywhere]">
                    {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">
                    {p.neighborhood || "Area unknown"} · {p.category ?? "no type"}
                  </p>
                </div>
                <span
                  className={`text-[11px] shrink-0 rounded-full px-2 py-0.5 font-medium ${
                    STATE_TONE[p.reverification_state]
                  }`}
                >
                  {STATE_LABEL[p.reverification_state]}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex gap-1.5 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Public status</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {MAINTENANCE_STATUS_LABEL[
                      p.maintenance_status as CommunityPlaceMaintenanceStatus
                    ] ?? p.maintenance_status}{" "}
                    · {p.is_active ? "Visible" : "Hidden"}
                  </dd>
                </div>
                <div className="flex gap-1.5 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Vegan</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {CLASSIFICATION_LABEL[p.veggie_classification ?? ""] ??
                      p.veggie_classification ??
                      "—"}
                  </dd>
                </div>
                <div className="flex gap-1.5 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Verified</dt>
                  <dd>{formatDate(p.verified_at)}</dd>
                </div>
                <div className="flex gap-1.5 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Reverified</dt>
                  <dd>
                    {p.last_reverified_at ? formatDate(p.last_reverified_at) : "Never"}
                    {age != null && ` · ${age}d ago`}
                  </dd>
                </div>
                <div className="flex gap-1.5 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Google Place ID</dt>
                  <dd>{p.has_google_place_id ? "Present" : "Missing"}</dd>
                </div>
                <div className="flex gap-1.5 min-w-0">
                  <dt className="text-muted-foreground shrink-0">Open reports</dt>
                  <dd>{p.open_reports_count}</dd>
                </div>
              </dl>

              {p.reverification_state === "needs_action" && p.needs_action_result && (
                <p className="mt-2 text-xs text-destructive [overflow-wrap:anywhere]">
                  Last review result: {RESULT_LABEL[p.needs_action_result]} — awaiting an explicit
                  owner decision.
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap gap-2">
                {p.open_review_id ? (
                  <Button
                    size="sm"
                    onClick={() => navigate(`/owner/places/${p.id}/reverify`)}
                  >
                    Continue reverification
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => startM.mutate(p.id)}
                    disabled={startM.isPending}
                    aria-label={`Start reverification for ${p.name}`}
                  >
                    {startM.isPending && startM.variables === p.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      "Start reverification"
                    )}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
