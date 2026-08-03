import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
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
 *  existing Google + vegan verification flow. */
export function SuggestionQueue({ onPromoted }: { onPromoted?: (candidateId: string) => void }) {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("not_fully_vegan");
  const [notes, setNotes] = useState("");

  const q = useQuery({ queryKey: ["place-suggestion-queue"], queryFn: fetchSuggestionQueue });

  function refresh() {
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
      refresh();
      if (r.candidate_id) onPromoted?.(r.candidate_id);
      toast.success(
        "Private candidate created and the submitter was notified. Nothing is public yet.",
      );
    },
    onError: () => toast.error("We couldn't promote that suggestion. Nothing was changed."),
  });


  const rows = q.data ?? [];

  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-sm font-semibold">Community Suggestions ({rows.length})</h2>
      {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!q.isPending && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No community suggestions yet.</p>
      )}
      <ul className="min-w-0 space-y-2">

        {rows.map((s) => (
          <li key={s.id} className="min-w-0 overflow-hidden rounded-lg border p-3">
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
                {s.city_name ?? "—"} · {new Date(s.submitted_at).toLocaleDateString()}
              </p>
              {s.possible_duplicate && (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> Possible duplicate
                </p>
              )}
            </button>


            {openId === s.id && <Detail s={s} />}

            {openId === s.id && (
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
        ))}
      </ul>
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
      {s.possible_duplicate && <Row label="Duplicate reference" value="Possible duplicate of an existing place or suggestion" />}
      <Row label="Submitter profile" value={s.submitter_profile_id} />
      {s.promoted_candidate_id && <Row label="Promoted candidate" value={s.promoted_candidate_id} />}
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

