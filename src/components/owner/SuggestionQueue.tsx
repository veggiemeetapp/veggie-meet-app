import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  fetchSuggestionQueue,
  moderateSuggestion,
  promoteSuggestion,
  REJECTION_REASONS,
  type OwnerSuggestion,
  type SuggestionScope,
} from "@/lib/placeSuggestions";

const OWNER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  under_review: "Under review",
  approved: "Promoted",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

/** Owner-only community suggestion moderation queue. Nothing here publishes a
 *  place: promotion creates a private candidate that still has to pass the
 *  existing Google + vegan verification flow.
 *
 *  WO-109 DEF-109-01: handled suggestions (promoted / rejected / duplicate)
 *  used to stay in the single flat list, so the queue could never visually
 *  clear. The lifecycle is now split server-side into Active (pending,
 *  under_review) and History (everything else) — no records are deleted. */
export function SuggestionQueue({ onPromoted }: { onPromoted?: (candidateId: string) => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<SuggestionScope>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("not_fully_vegan");
  const [notes, setNotes] = useState("");

  const activeQ = useQuery({
    queryKey: ["place-suggestion-queue", "active"],
    queryFn: () => fetchSuggestionQueue("active"),
  });
  const historyQ = useQuery({
    queryKey: ["place-suggestion-queue", "history"],
    queryFn: () => fetchSuggestionQueue("history"),
  });

  const q = scope === "active" ? activeQ : historyQ;

  function refresh() {
    // Server-confirmed state only: both scopes refetch after a mutation
    // succeeds, so a handled row leaves Active and appears in History.
    qc.invalidateQueries({ queryKey: ["place-suggestion-queue"] });
    qc.invalidateQueries({ queryKey: ["place-candidates"] });
  }

  const moderateM = useMutation({
    mutationFn: (v: { id: string; action: "start_review" | "reject" | "duplicate" }) =>
      moderateSuggestion(v.id, v.action, v.action === "reject" ? reason : undefined, notes || undefined),
    onSuccess: (r, v) => {
      if (!r.ok) return toast.error(`Not applied: ${r.reason}`);
      setNotes("");
      refresh();
      const type =
        v.action === "start_review"
          ? "place_suggestion_under_review"
          : v.action === "duplicate"
            ? "place_suggestion_duplicate"
            : "place_suggestion_rejected";
      logAnalyticsEvent("place_suggestion_notification_created", {
        notification_type: type,
        suggestion_id: v.id,
      });
      toast.success("Suggestion updated. The submitter was notified in-app.");
    },
    onError: () => toast.error("We couldn't apply that moderation action. Nothing was changed."),
  });

  const promoteM = useMutation({
    mutationFn: (id: string) => promoteSuggestion(id),
    onSuccess: (r, id) => {
      if (!r.ok) return toast.error(`Not promoted: ${r.reason}`);
      logAnalyticsEvent("community_place_suggestion_promoted", { suggestion_id: id });
      logAnalyticsEvent("place_suggestion_notification_created", {
        notification_type: "place_suggestion_approved",
        suggestion_id: id,
      });
      setOpenId(null);
      refresh();
      if (r.candidate_id) onPromoted?.(r.candidate_id);
      toast.success(
        "Private candidate created and the submitter was notified. Nothing is public yet.",
      );
    },
    onError: () => toast.error("We couldn't promote that suggestion. Nothing was changed."),
  });

  const rows = q.data ?? [];
  const activeCount = activeQ.data?.length ?? 0;
  const historyCount = historyQ.data?.length ?? 0;

  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-sm font-semibold">Community Suggestions ({activeCount})</h2>

      {/* Compact segmented control; wraps instead of scrolling on 320px. */}
      <div role="tablist" aria-label="Suggestion lifecycle" className="flex flex-wrap gap-1 rounded-control bg-muted p-1">
        {(
          [
            { id: "active" as const, label: `Needs review (${activeCount})` },
            { id: "history" as const, label: `Handled (${historyCount})` },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`suggestion-tab-${t.id}`}
            aria-selected={scope === t.id}
            aria-controls={`suggestion-panel-${t.id}`}
            onClick={() => {
              setScope(t.id);
              setOpenId(null);
            }}
            className={`min-h-9 min-w-0 flex-1 rounded-control px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              scope === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`suggestion-panel-${scope}`} aria-labelledby={`suggestion-tab-${scope}`} className="min-w-0">
        {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!q.isPending && rows.length === 0 && scope === "active" && (
          <div className="rounded-control border border-dashed p-4 text-center">
            <p className="text-sm font-medium">No Community Suggestions to review.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              New member suggestions will appear here when they need your attention.
            </p>
          </div>
        )}
        {!q.isPending && rows.length === 0 && scope === "history" && (
          <p className="text-sm text-muted-foreground">No handled suggestions yet.</p>
        )}

        <ul className="min-w-0 space-y-2">
          {rows.map((s) => {
            const handled = scope === "history";
            return (
              <li key={s.id} className="min-w-0 overflow-hidden rounded-control border p-3">
                <button
                  type="button"
                  className="block w-full min-w-0 text-left"
                  aria-expanded={openId === s.id}
                  onClick={() => {
                    const next = openId === s.id ? null : s.id;
                    setOpenId(next);
                    if (next) logAnalyticsEvent("community_place_suggestion_owner_opened", { suggestion_id: s.id });
                  }}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span
                      className="min-w-0 flex-1 text-sm font-medium line-clamp-3 [overflow-wrap:anywhere]"
                      title={s.place_name}
                    >
                      {s.place_name}
                    </span>
                    <span className="text-[11px] shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {OWNER_STATUS_LABEL[s.moderation_status] ?? s.moderation_status}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {s.city_name ?? "—"} ·{" "}
                    {handled
                      ? `Handled ${new Date(s.resolved_at ?? s.submitted_at).toLocaleDateString()}`
                      : new Date(s.submitted_at).toLocaleDateString()}
                  </p>
                  {/* In History, lifecycle status outranks the duplicate hint:
                      it's audit context, not outstanding owner work. */}
                  {s.possible_duplicate && !handled && (
                    <p className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px] font-medium text-warning">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> Possible match
                      {s.duplicate_match ? `: ${s.duplicate_match.name}` : ""}
                    </p>
                  )}
                  {s.possible_duplicate && handled && (
                    <p className="mt-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                      Flagged as a possible match for{" "}
                      {s.duplicate_match?.name ?? "an existing place"} at review time
                    </p>
                  )}
                </button>

                {openId === s.id && <Detail s={s} />}

                {openId === s.id && handled && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                    {s.published_place_id ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/place/${s.published_place_id}`}>View Community Place</Link>
                      </Button>
                    ) : s.promoted_candidate_id ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/owner/places?tab=candidates">View candidate</Link>
                      </Button>
                    ) : null}
                    <p className="w-full text-[11px] text-muted-foreground">
                      Handled suggestions are read-only history. Nothing here changes a candidate or a
                      published place.
                    </p>
                  </div>
                )}

                {openId === s.id && !handled && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <label className="text-xs font-medium" htmlFor={`reason-${s.id}`}>
                      Internal reason (for reject)
                    </label>
                    <select
                      id={`reason-${s.id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {REJECTION_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <Textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Internal moderation notes (never shown to the submitter)"
                      aria-label="Internal moderation notes"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Start review of ${s.place_name}`}
                        disabled={moderateM.isPending}
                        onClick={() => moderateM.mutate({ id: s.id, action: "start_review" })}
                      >
                        Start Review
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Mark ${s.place_name} as duplicate`}
                        disabled={moderateM.isPending}
                        onClick={() => moderateM.mutate({ id: s.id, action: "duplicate" })}
                      >
                        Mark Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Reject ${s.place_name}`}
                        disabled={moderateM.isPending}
                        onClick={() => moderateM.mutate({ id: s.id, action: "reject" })}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`Promote ${s.place_name} to a private candidate`}
                        disabled={promoteM.isPending || !!s.promoted_candidate_id}
                        onClick={() => promoteM.mutate(s.id)}
                      >
                        {promoteM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Promote to Candidate"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Promotion creates a private draft candidate only. Publishing still requires the
                      full Google Places and 100% vegan verification steps below.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Detail({ s }: { s: OwnerSuggestion }) {
  return (
    <dl className="mt-3 min-w-0 space-y-2 text-xs">
      <Row label="Full submitted name" value={s.place_name} />
      <Row label="Submitted address" value={s.address_text} />
      <div className="min-w-0">
        <dt className="font-medium">Official source</dt>
        <dd className="mt-0.5 min-w-0">
          <a
            href={s.official_source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="block max-w-full [overflow-wrap:anywhere] break-words text-primary underline"
          >
            {s.official_source_url}
            <ExternalLink className="ml-1 inline h-3 w-3 shrink-0 align-baseline" aria-hidden />
          </a>
        </dd>
      </div>
      <Row label="Why 100% vegan" value={s.vegan_reason} />
      {s.submitter_note && <Row label="Submitter note" value={s.submitter_note} />}
      {s.rejection_reason && <Row label="Internal rejection reason" value={s.rejection_reason} />}
      <Row label="Submitter profile" value={s.submitter_profile_id} />
      {s.promoted_candidate_id && <Row label="Promoted candidate" value={s.promoted_candidate_id} />}
      {s.duplicate_match && <MatchContext m={s.duplicate_match} />}
    </dl>
  );
}

/** WO-110: owner comparison context. A possible match is review information,
 *  never an automatic decision — the owner still promotes, rejects or marks it
 *  duplicate. */
function MatchContext({ m }: { m: NonNullable<OwnerSuggestion["duplicate_match"]> }) {
  const kind =
    m.entity_type === "place" ? "Community Place" : m.entity_type === "candidate" ? "candidate" : "suggestion";
  return (
    <div className="mt-3 min-w-0 rounded-control border border-warning/40 bg-warning/10 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        Possible existing match ({kind})
      </h3>
      <dl className="mt-2 space-y-2 text-xs">
        <Row label="Name" value={m.name} />
        {m.address && <Row label="Address" value={m.address} />}
        <Row label="Status" value={m.status ?? "—"} />
        <Row label="Why flagged" value={m.reasons.length ? m.reasons.join(" · ") : "Similar identity"} />
      </dl>
      {m.published_place_id && (
        <Button size="sm" variant="outline" className="mt-2" asChild>
          <Link to={`/place/${m.published_place_id}`}>View Community Place</Link>
        </Button>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        A different physical branch of the same business is not a duplicate. Use Mark Duplicate only
        when this is the same location.
      </p>
    </div>
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
