import { useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { logAnalyticsEvent } from "@/lib/analytics";
import { isOwner, fetchGooglePlaceDetails } from "@/lib/placeVerification";
import { MAINTENANCE_STATUS_LABEL } from "@/lib/placeMaintenance";
import { REPORT_REASON_LABEL } from "@/lib/placeReports";
import {
  CLOSURE_RESULTS,
  DETAILS_OBSERVED_OPTIONS,
  GOOGLE_OBSERVED_OPTIONS,
  RESULT_CONSEQUENCE,
  RESULT_LABEL,
  STATE_LABEL,
  STATE_TONE,
  VEGAN_OBSERVED_OPTIONS,
  cancelReverification,
  completeReverification,
  fetchReverificationWorkspace,
  formatDate,
  startReverification,
  type ReverificationResult,
} from "@/lib/placeReverification";
import type { CommunityPlaceMaintenanceStatus } from "@/types";
import type { PlaceReportReason } from "@/lib/placeReports";

const RESULT_ORDER: ReverificationResult[] = [
  "confirmed_current",
  "needs_place_update",
  "needs_vegan_review",
  "temporarily_closed",
  "permanently_closed",
  "duplicate_or_moved",
  "insufficient_evidence",
];

const CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian friendly",
  vegan_options: "Vegan options",
  not_food: "Community space",
};

/** Structured checklist items. Kept as discrete, labelled checkboxes — never a
 *  single unstructured free-text field. */
const GOOGLE_CHECKS = [
  { id: "gid", label: "Google Place ID still resolves" },
  { id: "gname", label: "Name still reasonably matches" },
  { id: "gaddr", label: "Address still reasonably matches" },
  { id: "gperm", label: "Not permanently closed on Google" },
  { id: "gtemp", label: "Not temporarily closed on Google" },
  { id: "gmoved", label: "Has not moved to a clearly different location" },
];

const VEGAN_CHECKS = [
  { id: "vstate", label: "Official website or social source still states fully vegan" },
  { id: "vmenu", label: "Current menu or official source shows no non-vegan products" },
  { id: "vprimary", label: "Evidence is a primary source (not aggregator or review site)" },
];

const DETAIL_CHECKS = [
  { id: "dname", label: "Name accurate" },
  { id: "daddr", label: "Address accurate" },
  { id: "darea", label: "Area accurate" },
  { id: "dcat", label: "Category accurate" },
  { id: "dsite", label: "Website accurate" },
  { id: "dmaps", label: "Maps link accurate" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 min-w-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="[overflow-wrap:anywhere] min-w-0">{children}</dd>
    </div>
  );
}

/**
 * WO-056 — Owner-only Community Place reverification workspace.
 *
 * Review-only by design. Completing a review never republishes, never creates a
 * place, never edits public detail fields and never deletes anything. The only
 * write to the public record is refreshing last_reverified_at on "Confirmed
 * current", or a closure status the owner explicitly opts into and confirms.
 */
export default function OwnerPlaceReverify() {
  const { placeId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [googleChecks, setGoogleChecks] = useState<Record<string, boolean>>({});
  const [veganChecks, setVeganChecks] = useState<Record<string, boolean>>({});
  const [detailChecks, setDetailChecks] = useState<Record<string, boolean>>({});
  const [googleObserved, setGoogleObserved] = useState<string>("");
  const [veganObserved, setVeganObserved] = useState<string>("");
  const [detailsObserved, setDetailsObserved] = useState<string>("");
  const [operational, setOperational] = useState<string>("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ReverificationResult | "">("");
  const [applyPlaceAction, setApplyPlaceAction] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);

  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });
  const wsQ = useQuery({
    queryKey: ["place-reverification-workspace", placeId],
    queryFn: () => fetchReverificationWorkspace(placeId),
    enabled: ownerQ.data === true && placeId.length > 0,
  });

  const place = wsQ.data?.place ?? null;
  const openReview = wsQ.data?.open_review ?? null;

  const noteError = useMemo(() => {
    const len = note.trim().length;
    if (!len) return "An internal reverification note is required.";
    // When the owner also applies the public closure status, the same note is
    // reused as the public-facing status reason, which allows 500 characters.
    // Cap it here so the owner never hits an avoidable server-side failure.
    if (applyPlaceAction && len > 500)
      return "When you also apply the public status, keep the note to 500 characters or fewer.";
    if (len > 1000) return "Keep the note to 1000 characters or fewer.";
    return null;
  }, [note, applyPlaceAction]);

  const urlError = useMemo(() => {
    const v = evidenceUrl.trim();
    if (!v) {
      return result === "confirmed_current"
        ? "Confirming a place as current requires a primary evidence source URL."
        : null;
    }
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(v)) return "Enter a valid http(s) link.";
    return null;
  }, [evidenceUrl, result]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["place-reverification-queue"] });
    qc.invalidateQueries({ queryKey: ["place-reverification-workspace", placeId] });
    qc.invalidateQueries({ queryKey: ["place-maintenance"] });
    qc.invalidateQueries({ queryKey: ["community-places"] });
    qc.invalidateQueries({ queryKey: ["community-place"] });
  }

  const startM = useMutation({
    mutationFn: () => startReverification(placeId),
    onSuccess: (r) => {
      if (!r.duplicate) {
        logAnalyticsEvent("community_place_reverification_started", { place_id: placeId });
      }
      invalidate();
      setStatus("Reverification started. No public change was made.");
      toast.success("Reverification started. Nothing public changed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const googleM = useMutation({
    mutationFn: () => fetchGooglePlaceDetails(place?.google_place_id ?? ""),
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelM = useMutation({
    mutationFn: () => cancelReverification(placeId),
    onSuccess: () => {
      logAnalyticsEvent("community_place_reverification_cancelled", { place_id: placeId });
      invalidate();
      setStatus("Reverification cancelled. The place is unchanged.");
      toast.success("Reverification cancelled. The place is unchanged.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeM = useMutation({
    mutationFn: () =>
      completeReverification({
        placeId,
        result: result as ReverificationResult,
        ownerNote: note,
        officialSourceUrl: evidenceUrl.trim() || null,
        googleStatusObserved: googleObserved || null,
        veganStatusObserved: veganObserved || null,
        detailsStatusObserved: detailsObserved || null,
        applyPlaceAction,
      }),
    onSuccess: (r) => {
      logAnalyticsEvent("community_place_reverification_completed", {
        place_id: placeId,
        result,
        place_action_applied: r.place_action_applied,
      });
      invalidate();
      setStatus(
        r.needs_action
          ? `Review closed as ${RESULT_LABEL[result as ReverificationResult]}. The place is flagged for a separate owner decision.${
              r.place_action_applied ? " The public status was applied." : " No public change was made."
            }`
          : "Confirmed current. Only the freshness date was updated.",
      );
      toast.success(
        r.needs_action ? "Review closed and flagged for owner action." : "Confirmed current.",
      );
      setResult("");
      setNote("");
      setEvidenceUrl("");
      setApplyPlaceAction(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openConfirm(e: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = e.currentTarget;
    setConfirmOpen(true);
  }
  function closeConfirm() {
    setConfirmOpen(false);
    const el = triggerRef.current;
    if (el) requestAnimationFrame(() => el.focus());
  }

  if (ownerQ.isLoading) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (ownerQ.data !== true) {
    return (
      <div className="flex-1 grid place-items-center p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Permission denied</h1>
          <p className="text-sm text-muted-foreground">
            This area is limited to the VeggieMeet owner.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Back to Today
          </Button>
        </div>
      </div>
    );
  }

  const needsSecondConfirm =
    result !== "" && CLOSURE_RESULTS.includes(result as ReverificationResult);
  const canComplete =
    !!openReview && result !== "" && !noteError && !urlError && !completeM.isPending;

  return (
    <div className="flex-1 flex flex-col pb-24">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to owner places" onClick={() => navigate("/owner/places")}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">Reverify place</h1>
          <p className="text-xs text-muted-foreground">Owner only — review does not change the public page</p>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">{status}</p>

      <div className="p-4 space-y-6 max-w-3xl w-full mx-auto min-w-0">
        {wsQ.isLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading place…
          </p>
        )}
        {wsQ.isError && (
          <p className="text-sm text-destructive [overflow-wrap:anywhere]">
            {(wsQ.error as Error).message}
          </p>
        )}

        {place && (
          <>
            {/* ---- Current public record ---- */}
            <section className="space-y-2 min-w-0">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <h2 className="text-sm font-semibold [overflow-wrap:anywhere] min-w-0">
                  {place.name}
                </h2>
                <span
                  className={`text-[11px] shrink-0 rounded-full px-2 py-0.5 font-medium ${
                    STATE_TONE[openReview ? "under_review" : place.freshness]
                  }`}
                >
                  {STATE_LABEL[openReview ? "under_review" : place.freshness]}
                </span>
              </div>
              <dl className="rounded-lg border p-3 text-xs space-y-1 min-w-0">
                <Row label="Address">{place.address || "—"}</Row>
                <Row label="Coordinates">
                  {place.latitude != null && place.longitude != null
                    ? `${place.latitude}, ${place.longitude}`
                    : "—"}
                </Row>
                <Row label="Category">{place.category ?? "—"}</Row>
                <Row label="Google Place ID">{place.google_place_id ?? "Missing"}</Row>
                <Row label="Maps link">
                  {place.google_maps_url ? (
                    <a
                      href={place.google_maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex items-center gap-1 [overflow-wrap:anywhere]"
                    >
                      Open in Google Maps <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Official website">
                  {place.website_url ? (
                    <a
                      href={place.website_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary [overflow-wrap:anywhere]"
                    >
                      {place.website_url}
                    </a>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Visible to members">{place.is_active ? "Yes" : "No"}</Row>
                <Row label="Maintenance status">
                  {MAINTENANCE_STATUS_LABEL[
                    place.maintenance_status as CommunityPlaceMaintenanceStatus
                  ] ?? place.maintenance_status}
                </Row>
                <Row label="Verification status">{place.verification_status ?? "—"}</Row>
                <Row label="Vegan classification">
                  {CLASSIFICATION_LABEL[place.veggie_classification ?? ""] ??
                    place.veggie_classification ??
                    "—"}
                </Row>
                <Row label="Verified">{formatDate(place.verified_at)}</Row>
                <Row label="Last reverified">
                  {place.last_reverified_at ? formatDate(place.last_reverified_at) : "Never"}
                </Row>
              </dl>
            </section>

            {/* ---- Open member reports (safe summary) ---- */}
            <section className="space-y-2 min-w-0">
              <h2 className="text-sm font-semibold">
                Open member reports ({wsQ.data?.open_reports.length ?? 0})
              </h2>
              {(wsQ.data?.open_reports.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No open reports for this place.</p>
              ) : (
                <ul className="space-y-2">
                  {wsQ.data?.open_reports.map((r) => (
                    <li key={r.id} className="rounded-lg border p-3 text-xs space-y-1 min-w-0">
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {REPORT_REASON_LABEL[r.reason_code as PlaceReportReason] ?? r.reason_code}
                      </p>
                      <p className="text-muted-foreground">Submitted {formatDate(r.created_at)}</p>
                      <p className="line-clamp-4 [overflow-wrap:anywhere]">{r.explanation}</p>
                      {r.official_source_url && (
                        <a
                          href={r.official_source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary block [overflow-wrap:anywhere]"
                        >
                          {r.official_source_url}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Completing a reverification never resolves reports.{" "}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => navigate("/owner/places")}
                >
                  Open the report queue
                </button>
              </p>
            </section>

            {/* ---- Review ---- */}
            {!openReview ? (
              <section className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No reverification is open for this place.
                </p>
                <Button onClick={() => startM.mutate()} disabled={startM.isPending}>
                  {startM.isPending ? "Starting…" : "Start reverification"}
                </Button>
              </section>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Review opened {formatDate(openReview.started_at)}.
                </p>

                {/* A. Google identity */}
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                    A. Google identity
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => googleM.mutate()}
                    disabled={!place.google_place_id || googleM.isPending}
                    aria-label="Check this place against Google Places"
                  >
                    {googleM.isPending ? "Checking…" : "Check Google Place ID"}
                  </Button>
                  {googleM.data && (
                    <dl className="rounded-lg bg-muted/50 p-3 text-xs space-y-1 min-w-0">
                      <Row label="Name">{googleM.data.display_name ?? "—"}</Row>
                      <Row label="Address">{googleM.data.formatted_address ?? "—"}</Row>
                      <Row label="Business status">{googleM.data.business_status ?? "—"}</Row>
                      <Row label="Primary type">{googleM.data.primary_type ?? "—"}</Row>
                      <Row label="Coordinates">
                        {googleM.data.latitude != null && googleM.data.longitude != null
                          ? `${googleM.data.latitude.toFixed(5)}, ${googleM.data.longitude.toFixed(5)}`
                          : "—"}
                      </Row>
                      <p className="text-muted-foreground pt-1">
                        Place data © Google. Ratings, reviews, photos and hours are never requested.
                      </p>
                    </dl>
                  )}
                  <ChecklistGroup
                    items={GOOGLE_CHECKS}
                    state={googleChecks}
                    onChange={setGoogleChecks}
                  />
                  <RadioGroupField
                    legend="Observed Google identity"
                    name="google-observed"
                    options={GOOGLE_OBSERVED_OPTIONS}
                    value={googleObserved}
                    onChange={setGoogleObserved}
                  />
                </section>

                {/* B. Vegan evidence */}
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold">B. 100% vegan evidence</h2>
                  <ChecklistGroup
                    items={VEGAN_CHECKS}
                    state={veganChecks}
                    onChange={setVeganChecks}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="rv-evidence">
                      Evidence source URL{" "}
                      <span className="text-muted-foreground">
                        (required to confirm as current)
                      </span>
                    </Label>
                    <Input
                      id="rv-evidence"
                      inputMode="url"
                      value={evidenceUrl}
                      onChange={(e) => setEvidenceUrl(e.target.value)}
                      placeholder="https://"
                      aria-invalid={!!urlError}
                      aria-describedby={urlError ? "rv-evidence-error" : undefined}
                      className="[overflow-wrap:anywhere]"
                    />
                    {urlError && (
                      <p id="rv-evidence-error" className="text-xs text-destructive">
                        {urlError}
                      </p>
                    )}
                  </div>
                  <RadioGroupField
                    legend="Observed vegan status"
                    name="vegan-observed"
                    options={VEGAN_OBSERVED_OPTIONS}
                    value={veganObserved}
                    onChange={setVeganObserved}
                  />
                </section>

                {/* C. Public details */}
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold">C. Public details</h2>
                  <ChecklistGroup
                    items={DETAIL_CHECKS}
                    state={detailChecks}
                    onChange={setDetailChecks}
                  />
                  <RadioGroupField
                    legend="Observed public details"
                    name="details-observed"
                    options={DETAILS_OBSERVED_OPTIONS}
                    value={detailsObserved}
                    onChange={setDetailsObserved}
                  />
                </section>

                {/* D. Operational status */}
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold">D. Operational status</h2>
                  <RadioGroupField
                    legend="Observed operational status"
                    name="operational-observed"
                    options={[
                      { value: "operational", label: "Operational" },
                      { value: "temporarily_closed", label: "Temporarily closed" },
                      { value: "permanently_closed", label: "Permanently closed" },
                      { value: "unclear", label: "Unclear" },
                    ]}
                    value={operational}
                    onChange={setOperational}
                  />
                </section>

                {/* Completion */}
                <section className="space-y-3 min-w-0">
                  <h2 className="text-sm font-semibold">Complete the review</h2>
                  <RadioGroupField
                    legend="Result"
                    name="rv-result"
                    required
                    options={RESULT_ORDER.map((r) => ({ value: r, label: RESULT_LABEL[r] }))}
                    value={result}
                    onChange={(v) => {
                      setResult(v as ReverificationResult);
                      setApplyPlaceAction(false);
                    }}
                  />

                  {result !== "" && (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs [overflow-wrap:anywhere]">
                      {RESULT_CONSEQUENCE[result as ReverificationResult]}
                    </p>
                  )}

                  {needsSecondConfirm && (
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox
                        checked={applyPlaceAction}
                        onCheckedChange={(v) => setApplyPlaceAction(v === true)}
                        aria-label="Also apply this closure status to the public place"
                      />
                      <span className="[overflow-wrap:anywhere]">
                        Also apply this closure status to the public place now. Leave unchecked to
                        only flag it for a separate maintenance decision.
                      </span>
                    </label>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="rv-note">
                      Internal note <span className="text-destructive">(required)</span>
                    </Label>
                    <Textarea
                      id="rv-note"
                      rows={3}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      aria-required="true"
                      aria-invalid={!!noteError}
                      aria-describedby={noteError ? "rv-note-error" : "rv-note-help"}
                    />
                    {noteError ? (
                      <p id="rv-note-error" className="text-xs text-destructive">
                        {noteError}
                      </p>
                    ) : (
                      <p id="rv-note-help" className="text-xs text-muted-foreground">
                        Private to the owner. Never shown to members.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={(e) =>
                        needsSecondConfirm ? openConfirm(e) : completeM.mutate()
                      }
                      disabled={!canComplete}
                      aria-label="Complete this reverification"
                    >
                      {completeM.isPending ? "Saving…" : "Complete reverification"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => cancelM.mutate()}
                      disabled={cancelM.isPending}
                      aria-label="Cancel this reverification without changing the place"
                    >
                      Cancel review
                    </Button>
                  </div>
                </section>
              </>
            )}

            {/* ---- Immutable audit trail ---- */}
            {(wsQ.data?.history.length ?? 0) > 0 && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold">
                  Reverification history ({wsQ.data?.history.length})
                </h2>
                <ul className="space-y-2">
                  {wsQ.data?.history.map((h) => (
                    <li key={h.id} className="rounded-lg border p-3 text-xs space-y-0.5 min-w-0">
                      <p className="font-medium">
                        {h.result ? RESULT_LABEL[h.result] : "Cancelled"} ·{" "}
                        {formatDate(h.completed_at)}
                      </p>
                      {h.owner_note && (
                        <p className="text-muted-foreground [overflow-wrap:anywhere]">
                          {h.owner_note}
                        </p>
                      )}
                      {h.official_source_url && (
                        <a
                          href={h.official_source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary block [overflow-wrap:anywhere]"
                        >
                          {h.official_source_url}
                        </a>
                      )}
                      <p className="text-muted-foreground">
                        Public status action applied: {h.place_action_applied ? "Yes" : "No"}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && closeConfirm()}>
        <AlertDialogContent className="max-w-[min(92vw,32rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              {result ? RESULT_LABEL[result as ReverificationResult] : "Confirm"} —{" "}
              {place?.name ?? "this place"}
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {result && RESULT_CONSEQUENCE[result as ReverificationResult]}
              {applyPlaceAction
                ? ` You have chosen to apply this status now: ${place?.name ?? "this place"} will publicly become ${
                    result === "permanently_closed" ? "Permanently closed" : "Temporarily closed"
                  }.`
                : " No public change will be made — the place is only flagged for you."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                closeConfirm();
                completeM.mutate();
              }}
            >
              Yes, record this result
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Labelled checkbox list. Each control has its own visible text label. */
function ChecklistGroup({
  items,
  state,
  onChange,
}: {
  items: { id: string; label: string }[];
  state: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.id}>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={state[it.id] === true}
              onCheckedChange={(v) => onChange({ ...state, [it.id]: v === true })}
              aria-label={it.label}
            />
            <span className="[overflow-wrap:anywhere]">{it.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Native radio group — keyboard operable, grouped and labelled by a fieldset. */
function RadioGroupField({
  legend,
  name,
  options,
  value,
  onChange,
  required,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5 min-w-0">
      <legend className="text-xs font-medium">
        {legend}
        {required && <span className="text-destructive"> (required)</span>}
      </legend>
      {options.map((o) => (
        <label key={o.value} className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="[overflow-wrap:anywhere]">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
