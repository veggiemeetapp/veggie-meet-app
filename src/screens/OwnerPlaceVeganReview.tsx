import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
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
import { isOwner } from "@/lib/placeVerification";
import { MAINTENANCE_STATUS_LABEL } from "@/lib/placeMaintenance";
import { REPORT_REASON_LABEL, type PlaceReportReason } from "@/lib/placeReports";
import type { CommunityPlaceMaintenanceStatus } from "@/types";
import {
  ACCEPTABLE_EVIDENCE,
  CONFIDENCE_OPTIONS,
  IDENTITY_CHECKS,
  INSUFFICIENT_EVIDENCE_SOURCES,
  PRODUCT_CHECKS,
  RESTORE_RESULT_CONSEQUENCE,
  RESULT_CONSEQUENCE,
  RESULT_LABEL,
  SOURCE_CHECKS,
  VEGAN_CLASSIFICATION_LABEL,
  blockMessage,
  cancelVeganReview,
  completeVeganReview,
  fetchVeganReviewWorkspace,
  formatDate,
  startVeganReview,
  veganEvidenceUrlError,
  type EvidenceConfidence,
  type VeganPublicAction,
  type VeganReviewResult,
} from "@/lib/veganReview";

const RESULT_ORDER: VeganReviewResult[] = [
  "confirmed_fully_vegan",
  "insufficient_evidence",
  "no_longer_fully_vegan",
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 min-w-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="[overflow-wrap:anywhere] min-w-0">{children}</dd>
    </div>
  );
}

function CheckGroup({
  legend,
  hint,
  items,
  selected,
  onToggle,
}: {
  legend: string;
  hint?: string;
  items: ReadonlyArray<{ id: string; label: string }>;
  selected: Record<string, boolean>;
  onToggle: (id: string, next: boolean) => void;
}) {
  return (
    <fieldset className="rounded-control border p-3 space-y-2 min-w-0">
      <legend className="px-1 text-xs font-semibold">{legend}</legend>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="space-y-2">
        {items.map((c) => (
          <div key={c.id} className="flex items-start gap-2 min-w-0">
            <Checkbox
              id={`chk-${c.id}`}
              className="mt-0.5 h-5 w-5"
              checked={selected[c.id] === true}
              onCheckedChange={(v) => onToggle(c.id, v === true)}
            />
            <Label htmlFor={`chk-${c.id}`} className="text-xs leading-snug font-normal min-w-0 [overflow-wrap:anywhere]">
              {c.label}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * WO-058 — Owner-only Community Place vegan verification review.
 *
 * Starting a review never touches the public place. The 100% Vegan
 * classification is removed only through an explicitly confirmed completion,
 * which also hides the place from discovery in the same transaction. Records,
 * Google identity, operational status and historical relationships are always
 * preserved — nothing is ever deleted and no duplicate place is created.
 */
export default function OwnerPlaceVeganReview() {
  const { placeId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const reportId = params.get("report");
  const reverificationId = params.get("reverification");
  const entrySource = params.get("source") ?? "owner_places";

  const [sourceChecks, setSourceChecks] = useState<Record<string, boolean>>({});
  const [productChecks, setProductChecks] = useState<Record<string, boolean>>({});
  const [identityChecks, setIdentityChecks] = useState<Record<string, boolean>>({});
  const [confidence, setConfidence] = useState<EvidenceConfidence | "">("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<VeganReviewResult | "">("");
  const [insufficientAction, setInsufficientAction] = useState<"none" | "deactivate">("none");
  /** WO-058A — restore choice, only offered on a previously revoked place. */
  const [restoreAction, setRestoreAction] = useState<"none" | "restore_and_reactivate">("none");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [blockMsg, setBlockMsg] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const blockRef = useRef<HTMLParagraphElement | null>(null);

  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });
  const wsQ = useQuery({
    queryKey: ["vegan-review-workspace", placeId, reportId, reverificationId],
    queryFn: () => fetchVeganReviewWorkspace(placeId, reportId, reverificationId),
    enabled: ownerQ.data === true && placeId.length > 0,
  });

  const place = wsQ.data?.place ?? null;
  const openReview = wsQ.data?.open_review ?? null;

  useEffect(() => {
    if (ownerQ.data === true && placeId) {
      logAnalyticsEvent("community_place_vegan_review_opened", { source: entrySource });
    }
  }, [ownerQ.data, placeId, entrySource]);

  /**
   * WO-058A — a place whose 100% Vegan status was revoked can be reconfirmed.
   * Confirming always restores the classification server-side; returning it to
   * discovery is the separate, explicitly confirmed `restore_and_reactivate`.
   */
  const isRevoked = place?.veggie_classification === "not_confirmed_fully_vegan";
  const canRestoreVisibility =
    isRevoked && place?.maintenance_status === "operational" && place?.is_active === false;

  const publicAction: VeganPublicAction =
    result === "no_longer_fully_vegan"
      ? "revoke_and_deactivate"
      : result === "insufficient_evidence"
        ? insufficientAction
        : result === "confirmed_fully_vegan" && canRestoreVisibility
          ? restoreAction
          : "none";

  const urlError = useMemo(() => {
    const shape = veganEvidenceUrlError(evidenceUrl);
    if (shape) return shape;
    const v = evidenceUrl.trim();
    if (!v) {
      if (result === "confirmed_fully_vegan" || result === "no_longer_fully_vegan")
        return "This result requires a primary-source evidence link.";
      if (result === "insufficient_evidence" && confidence !== "no_source")
        return "Add the source you checked, or select “No current primary source found”.";
    }
    return null;
  }, [evidenceUrl, result, confidence]);

  const summaryError = useMemo(() => {
    const len = summary.trim().length;
    if (len === 0) return "An evidence summary is required.";
    if (len < 20) return "Describe the evidence in at least 20 characters.";
    if (len > 1000) return "Keep the evidence summary to 1,000 characters or fewer.";
    return null;
  }, [summary]);

  const noteError = useMemo(() => {
    const len = note.trim().length;
    if (len === 0) return "An internal owner note is required.";
    if (len > 500) return "Keep the internal note to 500 characters or fewer.";
    return null;
  }, [note]);

  const selectedIds = (m: Record<string, boolean>) =>
    Object.entries(m)
      .filter(([, v]) => v)
      .map(([k]) => k);

  const contradictionError = useMemo(() => {
    if (!result || !confidence) return null;
    const allProducts = PRODUCT_CHECKS.every((c) => productChecks[c.id]);
    const allSource = SOURCE_CHECKS.every((c) => sourceChecks[c.id]);
    const allIdentity = IDENTITY_CHECKS.every((c) => identityChecks[c.id]);
    if (result === "confirmed_fully_vegan") {
      if (confidence !== "confirms_fully_vegan")
        return "You cannot confirm 100% vegan status while the observed evidence says otherwise.";
      if (!allSource) return "Confirming requires every official-source observation.";
      if (!allProducts)
        return "Confirming requires that no non-vegan products were observed.";
      if (!allIdentity)
        return "Confirming requires that the evidence belongs to this business and branch.";
    }
    if (result === "no_longer_fully_vegan") {
      if (confidence !== "shows_non_vegan")
        return "Removing the 100% Vegan status requires a primary source that shows non-vegan products.";
      if (allProducts)
        return "You ruled out every non-vegan category, which contradicts this result.";
      if (!allIdentity)
        return "Confirm the evidence refers to this same business and branch before removing the status.";
      if (!sourceChecks["source_belongs_to_business"])
        return "Confirm the source belongs to this business before removing the status.";
    }
    if (result === "insufficient_evidence" && !["ambiguous", "no_source"].includes(confidence))
      return "Insufficient evidence requires ambiguous evidence or no usable source.";
    return null;
  }, [result, confidence, productChecks, sourceChecks, identityChecks]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["vegan-review-workspace", placeId] });
    qc.invalidateQueries({ queryKey: ["place-maintenance"] });
    qc.invalidateQueries({ queryKey: ["place-reverification-queue"] });
    qc.invalidateQueries({ queryKey: ["place-report-queue"] });
    qc.invalidateQueries({ queryKey: ["community-places"] });
    qc.invalidateQueries({ queryKey: ["community-place"] });
  }

  const startM = useMutation({
    mutationFn: () => startVeganReview(placeId),
    onSuccess: (r) => {
      if (!r.ok) {
        setBlockMsg(blockMessage(r.reason));
        logAnalyticsEvent("community_place_vegan_review_blocked", { reason: r.reason });
        return;
      }
      if (!r.duplicate) {
        logAnalyticsEvent("community_place_vegan_review_started", { place_id: placeId });
      }
      invalidate();
      setStatusMsg(
        r.duplicate
          ? "This place already had an open vegan review. Continuing that review."
          : "Vegan review started. No public change was made.",
      );
      toast.success(r.duplicate ? "Continuing the open review." : "Vegan review started.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelM = useMutation({
    mutationFn: () => cancelVeganReview(placeId),
    onSuccess: (r) => {
      if (!r.ok) {
        setBlockMsg(blockMessage(r.reason));
        return;
      }
      logAnalyticsEvent("community_place_vegan_review_cancelled", { place_id: placeId });
      invalidate();
      setStatusMsg("Vegan review cancelled. The place is unchanged.");
      toast.success("Vegan review cancelled. The place is unchanged.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeM = useMutation({
    mutationFn: () =>
      completeVeganReview({
        placeId,
        result: result as VeganReviewResult,
        evidenceSummary: summary,
        ownerNote: note,
        evidenceConfidence: confidence as EvidenceConfidence,
        sourceChecks: selectedIds(sourceChecks),
        productChecks: selectedIds(productChecks),
        identityChecks: selectedIds(identityChecks),
        evidenceSourceUrl: evidenceUrl.trim() || null,
        publicAction,
        confirmPublicAction: publicAction !== "none",
        relatedReportId: reportId,
        relatedReverificationId: reverificationId,
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        setBlockMsg(blockMessage(r.reason));
        logAnalyticsEvent("community_place_vegan_review_blocked", { reason: r.reason });
        requestAnimationFrame(() => blockRef.current?.focus());
        return;
      }
      setBlockMsg("");
      logAnalyticsEvent("community_place_vegan_review_completed", {
        result: r.result,
        public_action_applied: r.public_action_applied === true,
      });
      invalidate();
      setStatusMsg(
        r.result === "confirmed_fully_vegan"
          ? r.restored
            ? r.public_action_applied
              ? "Reconfirmed 100% vegan. The classification was restored and the place is visible in Community Places discovery again. All history was preserved."
              : "Reconfirmed 100% vegan. The classification was restored and the place stays hidden from discovery until you restore its visibility."
            : "Confirmed fully vegan. The 100% Vegan classification and the public place are unchanged; only the freshness date advanced."
          : r.result === "no_longer_fully_vegan"
            ? "The 100% Vegan classification was removed and the place is hidden from Community Places discovery. The record and its history are preserved."
            : r.public_action_applied
              ? "Recorded as insufficient evidence and the place was temporarily hidden from discovery. The classification is unchanged."
              : "Recorded as insufficient evidence. No public change was made.",
      );
      toast.success(
        r.restored ? "100% Vegan status reconfirmed." : "Vegan review completed.",
      );
      setResult("");
      setSummary("");
      setNote("");
      setEvidenceUrl("");
      setConfidence("");
      setSourceChecks({});
      setProductChecks({});
      setIdentityChecks({});
      setInsufficientAction("none");
      setRestoreAction("none");
      if (reportId) navigate("/owner/places?tab=reports");
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

  const formInvalid = !!summaryError || !!noteError || !!urlError || !!contradictionError;
  const canComplete = !!openReview && result !== "" && confidence !== "" && !formInvalid;
  const needsConfirm = publicAction !== "none";

  return (
    <div className="flex-1 flex flex-col pb-24">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to owner places"
          onClick={() => navigate(reportId ? "/owner/places?tab=reports" : "/owner/places")}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">Review vegan status</h1>
          <p className="text-xs text-muted-foreground">
            Owner only — starting a review does not change the public place
          </p>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {statusMsg}
      </p>

      <div className="p-4 space-y-6 max-w-3xl w-full mx-auto min-w-0">
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          Confirm whether this published Community Place still meets VeggieMeet’s 100% vegan
          standard.
        </p>

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
            <section className="space-y-2 min-w-0">
              <h2 className="text-sm font-semibold [overflow-wrap:anywhere] min-w-0">
                {place.name}
              </h2>
              <dl className="rounded-control border p-3 text-xs space-y-1 min-w-0">
                <Row label="Address">{place.address || "—"}</Row>
                <Row label="Area">{place.neighborhood || "—"}</Row>
                <Row label="Category">{place.category ?? "—"}</Row>
                <Row label="Visible to members">{place.is_active ? "Yes" : "No"}</Row>
                <Row label="Operational status">
                  {MAINTENANCE_STATUS_LABEL[
                    place.maintenance_status as CommunityPlaceMaintenanceStatus
                  ] ?? place.maintenance_status}
                </Row>
                <Row label="Verification status">{place.verification_status ?? "—"}</Row>
                <Row label="Vegan classification">
                  {VEGAN_CLASSIFICATION_LABEL[place.veggie_classification ?? ""] ??
                    place.veggie_classification ??
                    "—"}
                </Row>
                <Row label="Verified">{formatDate(place.verified_at)}</Row>
                <Row label="Last reverified">
                  {place.last_reverified_at ? formatDate(place.last_reverified_at) : "Never"}
                </Row>
                <Row label="Google Place ID">
                  {place.has_google_place_id ? "Present" : "Missing"}
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
                {place.veggie_reason && (
                  <Row label="Original verification note">{place.veggie_reason}</Row>
                )}
              </dl>
              <p className="text-[11px] text-muted-foreground">
                Starting a review does not change the public place.
              </p>
            </section>

            {/* Related member report — context only, never proof. */}
            {wsQ.data?.related_report && (
              <section className="rounded-control border p-3 space-y-1.5 min-w-0">
                <h2 className="text-xs font-semibold">Linked member report</h2>
                <p className="text-[11px] text-muted-foreground">
                  A member report can trigger a review but is never treated as proof. Completing
                  this vegan review does not resolve the report — resolve, dismiss or mark it
                  duplicate separately in the report queue.
                </p>
                <dl className="text-xs space-y-1 min-w-0">
                  <Row label="Reason">
                    {REPORT_REASON_LABEL[
                      wsQ.data.related_report.reason_code as PlaceReportReason
                    ] ?? wsQ.data.related_report.reason_code}
                  </Row>
                  <Row label="What they saw">{wsQ.data.related_report.explanation}</Row>
                  {wsQ.data.related_report.official_source_url && (
                    <Row label="Their source">
                      <a
                        href={wsQ.data.related_report.official_source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary [overflow-wrap:anywhere]"
                      >
                        {wsQ.data.related_report.official_source_url}
                      </a>
                    </Row>
                  )}
                  <Row label="Reported">{formatDate(wsQ.data.related_report.created_at)}</Row>
                </dl>
              </section>
            )}

            {/* Related reverification — immutable, unchanged by this review. */}
            {wsQ.data?.related_reverification && (
              <section className="rounded-control border p-3 space-y-1.5 min-w-0">
                <h2 className="text-xs font-semibold">Linked reverification</h2>
                <p className="text-[11px] text-muted-foreground">
                  This vegan review is linked to that completed reverification for the record. The
                  reverification itself is never modified and its result never changes here.
                </p>
                <dl className="text-xs space-y-1 min-w-0">
                  <Row label="Result">{wsQ.data.related_reverification.result ?? "—"}</Row>
                  <Row label="Completed">
                    {formatDate(wsQ.data.related_reverification.completed_at)}
                  </Row>
                  <Row label="Vegan evidence observed">
                    {wsQ.data.related_reverification.vegan_status_observed ?? "—"}
                  </Row>
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/owner/places/${placeId}/reverify`)}
                >
                  Back to reverification history
                </Button>
              </section>
            )}

            {/* Other open vegan-status reports for this place. */}
            {(wsQ.data?.open_vegan_reports.length ?? 0) > 0 && (
              <section className="rounded-control border p-3 space-y-1.5 min-w-0">
                <h2 className="text-xs font-semibold">
                  Open vegan-status reports ({wsQ.data?.open_vegan_reports.length})
                </h2>
                <ul className="space-y-1.5">
                  {wsQ.data?.open_vegan_reports.map((r) => (
                    <li key={r.id} className="text-xs [overflow-wrap:anywhere]">
                      {r.explanation}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Evidence standard */}
            <section className="rounded-control border p-3 space-y-2 min-w-0">
              <h2 className="text-xs font-semibold">Evidence standard</h2>
              <p className="text-[11px] text-muted-foreground">
                A place can be confirmed fully vegan only from a current first-party source:
              </p>
              <ul className="text-[11px] list-disc pl-4 space-y-0.5">
                {ACCEPTABLE_EVIDENCE.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                These may trigger a review but can never confirm status on their own:
              </p>
              <ul className="text-[11px] list-disc pl-4 space-y-0.5 text-muted-foreground">
                {INSUFFICIENT_EVIDENCE_SOURCES.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </section>

            {/* Start / cancel */}
            <section className="space-y-2">
              {!openReview ? (
                <Button onClick={() => startM.mutate()} disabled={startM.isPending}>
                  {startM.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                  )}
                  Start vegan review
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs rounded-full bg-sky-500/15 text-sky-700 px-2 py-0.5 font-medium">
                    Review open since {formatDate(openReview.started_at)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cancelM.mutate()}
                    disabled={cancelM.isPending}
                  >
                    Cancel review
                  </Button>
                </div>
              )}
            </section>

            {openReview && (
              <>
                <CheckGroup
                  legend="A. Official source"
                  items={SOURCE_CHECKS}
                  selected={sourceChecks}
                  onToggle={(id, v) => setSourceChecks((s) => ({ ...s, [id]: v }))}
                />
                <CheckGroup
                  legend="B. Menu and products"
                  hint="Tick only what the current official source actually rules out."
                  items={PRODUCT_CHECKS}
                  selected={productChecks}
                  onToggle={(id, v) => setProductChecks((s) => ({ ...s, [id]: v }))}
                />
                <CheckGroup
                  legend="C. Business identity"
                  items={IDENTITY_CHECKS}
                  selected={identityChecks}
                  onToggle={(id, v) => setIdentityChecks((s) => ({ ...s, [id]: v }))}
                />

                <fieldset className="rounded-control border p-3 space-y-2 min-w-0">
                  <legend className="px-1 text-xs font-semibold">D. Evidence confidence</legend>
                  {CONFIDENCE_OPTIONS.map((o) => (
                    <div key={o.value} className="flex items-start gap-2 min-w-0">
                      <input
                        type="radio"
                        id={`conf-${o.value}`}
                        name="evidence-confidence"
                        className="mt-1 h-4 w-4"
                        checked={confidence === o.value}
                        onChange={() => setConfidence(o.value)}
                      />
                      <Label
                        htmlFor={`conf-${o.value}`}
                        className="text-xs leading-snug font-normal min-w-0 [overflow-wrap:anywhere]"
                      >
                        {o.label}
                      </Label>
                    </div>
                  ))}
                </fieldset>

                <section className="space-y-3 min-w-0">
                  <div className="space-y-1.5">
                    <Label htmlFor="evidence-url" className="text-xs">
                      Primary evidence link
                    </Label>
                    <Input
                      id="evidence-url"
                      inputMode="url"
                      value={evidenceUrl}
                      onChange={(e) => setEvidenceUrl(e.target.value)}
                      placeholder="https://…"
                      aria-invalid={!!urlError}
                      aria-describedby={urlError ? "evidence-url-err" : undefined}
                      className="[overflow-wrap:anywhere]"
                    />
                    {urlError && (
                      <p id="evidence-url-err" className="text-[11px] text-destructive">
                        {urlError}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="evidence-summary" className="text-xs">
                      Evidence summary (private)
                    </Label>
                    <Textarea
                      id="evidence-summary"
                      rows={4}
                      maxLength={1000}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      aria-invalid={!!summaryError}
                      aria-describedby="evidence-summary-help"
                    />
                    <p id="evidence-summary-help" className="text-[11px] text-muted-foreground">
                      {summaryError ?? `${summary.trim().length}/1000 — never shown to members.`}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="owner-note" className="text-xs">
                      Internal owner note
                    </Label>
                    <Textarea
                      id="owner-note"
                      rows={3}
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      aria-invalid={!!noteError}
                      aria-describedby="owner-note-help"
                    />
                    <p id="owner-note-help" className="text-[11px] text-muted-foreground">
                      {noteError ?? `${note.trim().length}/500 — private.`}
                    </p>
                  </div>
                </section>

                <fieldset className="rounded-control border p-3 space-y-3 min-w-0">
                  <legend className="px-1 text-xs font-semibold">Review result</legend>
                  {RESULT_ORDER.map((r) => (
                    <div key={r} className="space-y-1 min-w-0">
                      <div className="flex items-start gap-2 min-w-0">
                        <input
                          type="radio"
                          id={`res-${r}`}
                          name="vegan-result"
                          className="mt-1 h-4 w-4"
                          checked={result === r}
                          onChange={() => {
                            setResult(r);
                            setInsufficientAction("none");
                            setRestoreAction("none");
                            setBlockMsg("");
                          }}
                        />
                        <Label htmlFor={`res-${r}`} className="text-xs font-medium min-w-0">
                          {isRevoked && r === "confirmed_fully_vegan"
                            ? "Reconfirm 100% vegan"
                            : RESULT_LABEL[r]}
                        </Label>
                      </div>
                      {result === r && (
                        <p className="text-[11px] text-muted-foreground pl-6 [overflow-wrap:anywhere]">
                          {isRevoked && r === "confirmed_fully_vegan"
                            ? RESTORE_RESULT_CONSEQUENCE
                            : RESULT_CONSEQUENCE[r]}
                        </p>
                      )}
                    </div>
                  ))}
                </fieldset>

                {result === "insufficient_evidence" && (
                  <fieldset className="rounded-control border p-3 space-y-2 min-w-0">
                    <legend className="px-1 text-xs font-semibold">
                      What should happen publicly?
                    </legend>
                    <p className="text-[11px] text-muted-foreground">
                      Insufficient evidence is not proof that this business serves non-vegan
                      products, and this never labels it non-vegan.
                    </p>
                    {(
                      [
                        {
                          v: "none" as const,
                          label: "Continue investigation — nothing changes publicly",
                        },
                        {
                          v: "deactivate" as const,
                          label:
                            "Temporarily hide from discovery — classification stays unchanged while hidden",
                        },
                      ] satisfies Array<{ v: "none" | "deactivate"; label: string }>
                    ).map((o) => (
                      <div key={o.v} className="flex items-start gap-2 min-w-0">
                        <input
                          type="radio"
                          id={`ins-${o.v}`}
                          name="insufficient-action"
                          className="mt-1 h-4 w-4"
                          checked={insufficientAction === o.v}
                          onChange={() => setInsufficientAction(o.v)}
                        />
                        <Label
                          htmlFor={`ins-${o.v}`}
                          className="text-xs leading-snug font-normal min-w-0 [overflow-wrap:anywhere]"
                        >
                          {o.label}
                        </Label>
                      </div>
                    ))}
                  </fieldset>
                )}

                {/* WO-058A — restore visibility after a reconfirmation. */}
                {result === "confirmed_fully_vegan" && isRevoked && (
                  <fieldset className="rounded-control border p-3 space-y-2 min-w-0">
                    <legend className="px-1 text-xs font-semibold">
                      What should happen publicly?
                    </legend>
                    <p className="text-[11px] text-muted-foreground">
                      The 100% Vegan classification is restored either way. Returning the place to
                      Community Places discovery is a separate, deliberate choice.
                    </p>
                    {canRestoreVisibility ? (
                      (
                        [
                          {
                            v: "none" as const,
                            label:
                              "Restore the classification only — the place stays hidden from discovery for now",
                          },
                          {
                            v: "restore_and_reactivate" as const,
                            label:
                              "Reconfirm and restore — bring the place back into Community Places discovery",
                          },
                        ] satisfies Array<{
                          v: "none" | "restore_and_reactivate";
                          label: string;
                        }>
                      ).map((o) => (
                        <div key={o.v} className="flex items-start gap-2 min-w-0">
                          <input
                            type="radio"
                            id={`rst-${o.v}`}
                            name="restore-action"
                            className="mt-1 h-4 w-4"
                            checked={restoreAction === o.v}
                            onChange={() => setRestoreAction(o.v)}
                          />
                          <Label
                            htmlFor={`rst-${o.v}`}
                            className="text-xs leading-snug font-normal min-w-0 [overflow-wrap:anywhere]"
                          >
                            {o.label}
                          </Label>
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                        {place?.is_active
                          ? "This place is already visible in discovery, so only the classification and freshness date are restored."
                          : "This place is not operational right now, so it cannot return to discovery here. Restore its operational status in published place maintenance first, then reconfirm."}
                      </p>
                    )}
                  </fieldset>
                )}



                {contradictionError && (
                  <p
                    ref={blockRef}
                    tabIndex={-1}
                    role="alert"
                    className="text-xs text-destructive [overflow-wrap:anywhere]"
                  >
                    {contradictionError}
                  </p>
                )}
                {blockMsg && (
                  <p
                    ref={blockRef}
                    tabIndex={-1}
                    role="alert"
                    className="text-xs text-destructive [overflow-wrap:anywhere]"
                  >
                    {blockMsg}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {needsConfirm ? (
                    <Button onClick={openConfirm} disabled={!canComplete || completeM.isPending}>
                      Complete review
                    </Button>
                  ) : (
                    <Button
                      onClick={() => completeM.mutate()}
                      disabled={!canComplete || completeM.isPending}
                    >
                      {completeM.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                      )}
                      Complete review
                    </Button>
                  )}
                </div>
              </>
            )}

            {/* Private history */}
            {(wsQ.data?.history.length ?? 0) > 0 && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold">Vegan review history</h2>
                <ul className="space-y-2">
                  {wsQ.data?.history.map((h) => (
                    <li key={h.id} className="rounded-control border p-3 text-xs space-y-1 min-w-0">
                      <Row label="Result">{h.result ?? "—"}</Row>
                      <Row label="Completed">{formatDate(h.completed_at)}</Row>
                      <Row label="Classification">
                        {(VEGAN_CLASSIFICATION_LABEL[h.prior_classification ?? ""] ??
                          h.prior_classification ??
                          "—") +
                          " → " +
                          (VEGAN_CLASSIFICATION_LABEL[h.resulting_classification ?? ""] ??
                            h.resulting_classification ??
                            "—")}
                      </Row>
                      <Row label="Public action">
                        {h.public_action_applied ? (h.public_action ?? "applied") : "None"}
                      </Row>
                      {h.evidence_source_url && (
                        <Row label="Evidence">
                          <a
                            href={h.evidence_source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary [overflow-wrap:anywhere]"
                          >
                            {h.evidence_source_url}
                          </a>
                        </Row>
                      )}
                      {h.owner_note && <Row label="Note">{h.owner_note}</Row>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(wsQ.data?.classification_history.length ?? 0) > 0 && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold">Classification history</h2>
                <ul className="space-y-1.5">
                  {wsQ.data?.classification_history.map((h) => (
                    <li key={h.id} className="text-xs [overflow-wrap:anywhere]">
                      {formatDate(h.changed_at)} — {h.action}:{" "}
                      {VEGAN_CLASSIFICATION_LABEL[h.old_classification ?? ""] ??
                        h.old_classification ??
                        "—"}{" "}
                      →{" "}
                      {VEGAN_CLASSIFICATION_LABEL[h.new_classification] ?? h.new_classification}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => (o ? setConfirmOpen(true) : closeConfirm())}>
        <AlertDialogContent className="max-w-[min(92vw,32rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              {publicAction === "restore_and_reactivate"
                ? `Reconfirm and restore ${place?.name ?? "this place"}?`
                : result === "no_longer_fully_vegan"
                  ? `Remove the 100% Vegan status from ${place?.name ?? "this place"}?`
                  : `Temporarily hide ${place?.name ?? "this place"} from discovery?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                {publicAction === "restore_and_reactivate" ? (
                  <ul className="list-disc pl-4 space-y-1">
                    <li>The 100% Vegan classification will be restored.</li>
                    <li>
                      The place will appear again in Community Places discovery, search and the
                      Host place picker, and members can check in again.
                    </li>
                    <li>The freshness date advances to today; the original verification date stays.</li>
                    <li>
                      The same record is reused — its Google identity, past visits, Meetups and
                      support counts are all preserved and nothing is duplicated.
                    </li>
                    <li>Its operational status is unchanged by this step.</li>
                  </ul>
                ) : result === "no_longer_fully_vegan" ? (
                  <ul className="list-disc pl-4 space-y-1">
                    <li>The 100% Vegan classification will be removed.</li>
                    <li>The place will be hidden from Community Places discovery and search.</li>
                    <li>It will be excluded from the Host place picker and new check-ins.</li>
                    <li>All historical records, visits, Meetups and support counts remain.</li>
                    <li>This does not mark the business closed and nothing is deleted.</li>
                    <li>
                      Making it visible again will require explicitly reconfirming 100% vegan
                      status here.
                    </li>
                  </ul>
                ) : (
                  <ul className="list-disc pl-4 space-y-1">
                    <li>The place will be hidden from Community Places discovery.</li>
                    <li>Its vegan classification stays unchanged while hidden.</li>
                    <li>No public statement is made about the business.</li>
                    <li>All historical records remain.</li>
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                completeM.mutate();
              }}
            >
              {publicAction === "restore_and_reactivate"
                ? "Reconfirm and restore"
                : result === "no_longer_fully_vegan"
                  ? "Remove and hide"
                  : "Hide from discovery"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
