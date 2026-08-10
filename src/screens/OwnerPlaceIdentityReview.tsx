import { safeBack } from "@/lib/navigation";
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
import { fieldLabelList } from "@/lib/fieldLabels";
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
import { REPORT_REASON_LABEL, type PlaceReportReason } from "@/lib/placeReports";
import { MAINTENANCE_STATUS_LABEL } from "@/lib/placeMaintenance";
import { VEGAN_CLASSIFICATION_LABEL } from "@/lib/veganReview";
import type { CommunityPlaceMaintenanceStatus } from "@/types";
import {
  ACCEPTABLE_EVIDENCE,
  ALLOWED_RESULTS,
  CASE_TYPES,
  CASE_TYPE_LABEL,
  IDENTITY_ACTION_LABEL,
  IDENTITY_RESULT_LABEL,
  INSUFFICIENT_EVIDENCE_SOURCES,
  RESULT_CONSEQUENCE,
  RESULT_LABEL,
  cancelIdentityReview,
  completeIdentityReview,
  distanceMeters,
  fetchIdentityReviewWorkspace,
  formatDistance,
  moveTier,

  formatIdentityDate,
  googlePlaceIdError,
  identityBlockMessage,
  identityUrlError,
  startIdentityReview,
  type IdentityCaseType,
  type IdentityResult,
} from "@/lib/placeIdentity";

/* Distance tiers live in @/lib/placeIdentity and mirror the server rules. */


function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 min-w-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="[overflow-wrap:anywhere] min-w-0">{children}</dd>
    </div>
  );
}

function Compare({
  label,
  current,
  proposed,
}: {
  label: string;
  current: string | null;
  proposed: string | null;
}) {
  const changed =
    (proposed ?? "").trim().length > 0 && (proposed ?? "").trim() !== (current ?? "").trim();
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-xs min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 space-y-0.5">
        <p className="[overflow-wrap:anywhere]">{current?.trim() || "—"}</p>
        {changed && (
          <p className="[overflow-wrap:anywhere] text-primary">→ {proposed?.trim()}</p>
        )}
      </div>
    </div>
  );
}

/**
 * WO-059 — owner-only Community Place identity replacement and location moves.
 *
 * Presentation only. Every rule below is re-checked and enforced server-side:
 * ownership, the case/result matrix, evidence, Google identity uniqueness,
 * distance limits and the all-or-nothing application of the public change.
 */
export default function OwnerPlaceIdentityReview() {
  const { placeId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const reportId = params.get("report");
  const reverificationId = params.get("reverification");
  const entrySource = params.get("source") ?? "direct";

  const [caseType, setCaseType] = useState<IdentityCaseType | "">("");
  const [result, setResult] = useState<IdentityResult | "">("");

  const [gid, setGid] = useState("");
  const [pname, setPname] = useState("");
  const [paddress, setPaddress] = useState("");
  const [pneighborhood, setPneighborhood] = useState("");
  const [plat, setPlat] = useState("");
  const [plng, setPlng] = useState("");
  const [pmaps, setPmaps] = useState("");
  const [pweb, setPweb] = useState("");

  const [sourceUrl, setSourceUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");

  const [sameBusiness, setSameBusiness] = useState(false);
  const [sameBranch, setSameBranch] = useState(false);
  const [relocation, setRelocation] = useState(false);

  const [applyIdentity, setApplyIdentity] = useState(true);
  const [applyName, setApplyName] = useState(false);
  const [applyLocation, setApplyLocation] = useState(false);
  const [applyWebsite, setApplyWebsite] = useState(false);
  const [ackMove, setAckMove] = useState(false);
  const [createCandidate, setCreateCandidate] = useState(true);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [blockMsg, setBlockMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const blockRef = useRef<HTMLParagraphElement | null>(null);

  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });

  const wsQ = useQuery({
    queryKey: ["identity-review-workspace", placeId, reportId, reverificationId],
    queryFn: () => fetchIdentityReviewWorkspace(placeId, reportId, reverificationId),
    enabled: ownerQ.data === true && !!placeId,
  });

  const place = wsQ.data?.place;
  const open = wsQ.data?.open_review ?? null;

  useEffect(() => {
    if (ownerQ.data === true && placeId) {
      logAnalyticsEvent("community_place_identity_review_opened", { source: entrySource });
    }
  }, [ownerQ.data, placeId, entrySource]);

  const latNum = plat.trim() === "" ? null : Number(plat);
  const lngNum = plng.trim() === "" ? null : Number(plng);
  const coordsInvalid =
    (plat.trim() !== "" && (!Number.isFinite(latNum) || Math.abs(latNum as number) > 90)) ||
    (plng.trim() !== "" && (!Number.isFinite(lngNum) || Math.abs(lngNum as number) > 180));

  const dist = useMemo(
    () =>
      coordsInvalid
        ? null
        : distanceMeters(place?.latitude ?? null, place?.longitude ?? null, latNum, lngNum),
    [coordsInvalid, place?.latitude, place?.longitude, latNum, lngNum],
  );

  const allowedResults = caseType ? ALLOWED_RESULTS[caseType] : [];

  const sameIdentity =
    !!place?.google_place_id && gid.trim() !== "" && gid.trim() === place.google_place_id;

  const gidError = googlePlaceIdError(gid);
  const sourceError = identityUrlError(sourceUrl);
  const mapsError = identityUrlError(pmaps);
  const webError = identityUrlError(pweb);

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

  const needsPublicChange = result === "identity_replaced" || result === "location_moved";

  const tier = moveTier(dist);
  const relocating = result === "location_moved" || (result === "identity_replaced" && applyLocation);
  const showNearby = relocating && tier === "nearby";
  const largeMove = relocating && (tier === "high_risk" || tier === "exceptional");


  const validationError = useMemo(() => {
    if (!caseType) return "Select what the evidence shows.";
    if (!result) return "Select the review result.";
    if (!allowedResults.includes(result))
      return "That result contradicts the case you selected. A different branch or business can never replace this place.";
    if (noteError) return noteError;
    if (summaryError) return summaryError;
    if (needsPublicChange && sourceUrl.trim() === "")
      return "This result requires a primary-source evidence link.";
    if (sourceError) return sourceError;
    if (mapsError) return mapsError;
    if (webError) return webError;
    if (gidError) return gidError;
    if (coordsInvalid) return "Coordinates must be valid latitude and longitude values.";
    if (needsPublicChange && !sameBusiness)
      return "Confirm the evidence refers to the same business.";
    if (needsPublicChange && !sameBranch)
      return "Confirm the evidence refers to this same branch.";
    if (result === "location_moved" && !relocation)
      return "Confirm the business itself moved.";
    if (result === "identity_replaced" && gid.trim() === "")
      return "A verified Google Place ID is required to replace the identity.";
    if (result === "location_moved" && (paddress.trim() === "" || latNum == null || lngNum == null))
      return "A relocation needs the new address and its coordinates.";
    if (result === "new_branch_required" && createCandidate && gid.trim() === "")
      return "A new branch draft needs its own Google Place ID.";
    if (largeMove && !ackMove)
      return "This is a large move. Acknowledge the distance before applying it.";
    return null;
  }, [
    caseType,
    result,
    allowedResults,
    noteError,
    summaryError,
    needsPublicChange,
    sourceUrl,
    sourceError,
    mapsError,
    webError,
    gidError,
    coordsInvalid,
    sameBusiness,
    sameBranch,
    relocation,
    gid,
    paddress,
    latNum,
    lngNum,
    createCandidate,
    largeMove,
    ackMove,
  ]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["identity-review-workspace", placeId] });
    qc.invalidateQueries({ queryKey: ["place-maintenance"] });
    qc.invalidateQueries({ queryKey: ["place-report-queue"] });
    qc.invalidateQueries({ queryKey: ["place-reverification-queue"] });
    qc.invalidateQueries({ queryKey: ["community-places"] });
    qc.invalidateQueries({ queryKey: ["community-place"] });
    qc.invalidateQueries({ queryKey: ["manage-places"] });
  }

  const startM = useMutation({
    mutationFn: () => startIdentityReview(placeId),
    onSuccess: (r) => {
      if (!r.ok) {
        setBlockMsg(identityBlockMessage(r.reason, r.conflict));
        return;
      }
      logAnalyticsEvent("community_place_identity_review_started", { duplicate: !!r.duplicate });
      invalidate();
      setStatusMsg(
        r.duplicate
          ? "This place already had an open identity review. Continuing that review."
          : "Identity review started. No public change was made.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelM = useMutation({
    mutationFn: () => cancelIdentityReview(placeId),
    onSuccess: (r) => {
      if (!r.ok) {
        setBlockMsg(identityBlockMessage(r.reason, r.conflict));
        return;
      }
      logAnalyticsEvent("community_place_identity_review_cancelled", {});
      invalidate();
      setStatusMsg("Identity review cancelled. The place is unchanged.");
      toast.success("Identity review cancelled. The place is unchanged.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeM = useMutation({
    mutationFn: () =>
      completeIdentityReview({
        placeId,
        caseType: caseType as IdentityCaseType,
        result: result as IdentityResult,
        proposedGooglePlaceId: gid.trim() || null,
        proposedName: pname.trim() || null,
        proposedAddress: paddress.trim() || null,
        proposedNeighborhood: pneighborhood.trim() || null,
        proposedLatitude: latNum,
        proposedLongitude: lngNum,
        proposedMapsUrl: pmaps.trim() || null,
        proposedWebsiteUrl: pweb.trim() || null,
        officialSourceUrl: sourceUrl.trim() || null,
        evidenceSummary: summary,
        ownerNote: note,
        sameBusinessConfirmed: sameBusiness,
        sameBranchConfirmed: sameBranch,
        relocationConfirmed: relocation,
        applyGoogleIdentity: applyIdentity,
        applyName,
        applyLocation: result === "location_moved" ? true : applyLocation,
        applyWebsite,
        confirmPublicAction: needsPublicChange,
        acknowledgeLargeMove: ackMove,
        createCandidate: result === "new_branch_required" && createCandidate,
        relatedReportId: reportId,
        relatedReverificationId: reverificationId,
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        setBlockMsg(identityBlockMessage(r.reason, r.conflict));
        logAnalyticsEvent("community_place_identity_review_blocked", { reason: r.reason });
        requestAnimationFrame(() => blockRef.current?.focus());
        return;
      }
      setBlockMsg("");
      logAnalyticsEvent("community_place_identity_review_completed", {
        result: r.result,
        public_action_applied: r.public_action_applied === true,
      });
      invalidate();
      setStatusMsg(
        r.no_op && !r.public_action_applied
          ? "Nothing needed changing — the proposed identity already matches this place. The review was recorded."
          : r.result === "identity_replaced"
            ? `Google identity replaced. Updated: ${fieldLabelList(r.changed_fields)}. Vegan classification, status, visibility and all member history were preserved.`
            : r.result === "location_moved"
              ? `Relocation recorded (${formatDistance(r.distance_meters ?? null)}). The same place record was kept — existing Meetups were not cancelled or moved.`
              : r.result === "new_branch_required"
                ? r.candidate_id
                  ? "This place is unchanged. A private draft was created for the new branch — it must pass its own verification before publication."
                  : "This place is unchanged. The decision was recorded."
                : "This place is unchanged. The decision and its evidence were recorded.",
      );
      toast.success(
        r.public_action_applied ? "Identity change applied." : "Identity review recorded.",
      );
      setResult("");
      setCaseType("");
      setSummary("");
      setNote("");
      setSourceUrl("");
      setGid("");
      setPname("");
      setPaddress("");
      setPneighborhood("");
      setPlat("");
      setPlng("");
      setPmaps("");
      setPweb("");
      setSameBusiness(false);
      setSameBranch(false);
      setRelocation(false);
      setAckMove(false);
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

  const pending = startM.isPending || cancelM.isPending || completeM.isPending;

  if (ownerQ.isLoading) {
    return (
      <div className="p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (ownerQ.data !== true) {
    return (
      <div className="p-4 space-y-3">
        <h1 className="text-base font-semibold">Not available</h1>
        <p className="text-sm text-muted-foreground">
          This workspace is only available to the VeggieMeet team.
        </p>
        <Button size="sm" variant="outline" onClick={() => navigate("/")}>
          Back to VeggieMeet
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-2 p-3 min-w-0">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back"
            onClick={() => safeBack(navigate, "/owner/places")}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-semibold truncate">Identity review</h1>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto min-w-0">
        <p aria-live="polite" className="sr-only">
          {statusMsg}
        </p>

        {wsQ.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {wsQ.error && (
          <p className="text-sm text-destructive [overflow-wrap:anywhere]">
            {(wsQ.error as Error).message}
          </p>
        )}

        {place && (
          <>
            <section className="rounded-control border p-3 space-y-1 min-w-0">
              <h2 className="text-sm font-semibold [overflow-wrap:anywhere]">{place.name}</h2>
              <dl className="text-xs space-y-0.5">
                <Row label="Address">{place.address ?? "—"}</Row>
                <Row label="Area">{place.neighborhood ?? "—"}</Row>
                <Row label="Coordinates">
                  {place.latitude != null && place.longitude != null
                    ? `${place.latitude}, ${place.longitude}`
                    : "—"}
                </Row>
                <Row label="Google Place ID">{place.google_place_id ?? "—"}</Row>
                <Row label="Classification">
                  {VEGAN_CLASSIFICATION_LABEL[place.veggie_classification ?? ""] ??
                    place.veggie_classification ??
                    "—"}
                </Row>
                <Row label="Status">
                  {MAINTENANCE_STATUS_LABEL[
                    place.maintenance_status as CommunityPlaceMaintenanceStatus
                  ] ?? place.maintenance_status}{" "}
                  · {place.is_active ? "in discovery" : "hidden from discovery"}
                </Row>
                <Row label="Freshness">{place.freshness ?? "—"}</Row>
                {place.google_maps_url && (
                  <Row label="Map">
                    <a
                      href={place.google_maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex items-center gap-1"
                    >
                      Open in Google Maps <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </Row>
                )}
              </dl>
            </section>

            {statusMsg && (
              <p className="rounded-control border border-primary/40 bg-primary/5 p-3 text-xs [overflow-wrap:anywhere]">
                {statusMsg}
              </p>
            )}

            {blockMsg && (
              <p
                ref={blockRef}
                tabIndex={-1}
                role="alert"
                className="rounded-control border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive [overflow-wrap:anywhere]"
              >
                {blockMsg}
              </p>
            )}

            {wsQ.data?.related_report && (
              <section className="rounded-control border p-3 text-xs space-y-1 min-w-0">
                <h2 className="text-sm font-semibold">Linked member report</h2>
                <Row label="Reason">
                  {REPORT_REASON_LABEL[
                    wsQ.data.related_report.reason_code as PlaceReportReason
                  ] ?? wsQ.data.related_report.reason_code}
                </Row>
                {wsQ.data.related_report.explanation && (
                  <p className="[overflow-wrap:anywhere]">
                    {wsQ.data.related_report.explanation}
                  </p>
                )}
                <p className="text-muted-foreground">
                  A member report is a trigger to check, never evidence on its own.
                </p>
              </section>
            )}

            {(wsQ.data?.open_identity_reports.length ?? 0) > 0 && (
              <section className="rounded-control border p-3 text-xs space-y-1 min-w-0">
                <h2 className="text-sm font-semibold">
                  Open identity-related reports ({wsQ.data?.open_identity_reports.length})
                </h2>
                <ul className="space-y-1 list-none p-0 m-0">
                  {wsQ.data?.open_identity_reports.map((r) => (
                    <li key={r.id} className="[overflow-wrap:anywhere]">
                      {REPORT_REASON_LABEL[r.reason_code as PlaceReportReason] ?? r.reason_code}
                      {r.explanation ? ` — ${r.explanation}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-control border p-3 text-xs space-y-2 min-w-0">
              <h2 className="text-sm font-semibold">What counts as evidence</h2>
              <ul className="list-disc pl-4 space-y-0.5">
                {ACCEPTABLE_EVIDENCE.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">Never enough on their own:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                {INSUFFICIENT_EVIDENCE_SOURCES.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </section>

            {!open ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Starting a review changes nothing publicly. It only opens a private, auditable
                  record so the identity question can be resolved with evidence.
                </p>
                <Button size="sm" disabled={pending} onClick={() => startM.mutate()}>
                  {startM.isPending ? "Starting…" : "Start identity review"}
                </Button>
              </div>
            ) : (
              <>
                <section className="space-y-2 min-w-0">
                  <h2 className="text-sm font-semibold">1. What does the evidence show?</h2>
                  <div className="space-y-1.5">
                    {CASE_TYPES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={caseType === c.value}
                        onClick={() => {
                          setCaseType(c.value);
                          setResult("");
                          setAckMove(false);
                        }}
                        className={`w-full text-left rounded-control border p-3 text-xs transition-colors min-w-0 ${
                          caseType === c.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                        }`}
                      >
                        <span className="block font-medium [overflow-wrap:anywhere]">
                          {c.label}
                        </span>
                        <span className="block text-muted-foreground [overflow-wrap:anywhere]">
                          {c.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {caseType && (
                  <section className="space-y-2 min-w-0">
                    <h2 className="text-sm font-semibold">2. Result</h2>
                    <div className="space-y-1.5">
                      {allowedResults.map((r) => (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={result === r}
                          onClick={() => {
                            setResult(r);
                            setAckMove(false);
                          }}
                          className={`w-full text-left rounded-control border p-3 text-xs transition-colors min-w-0 ${
                            result === r ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                          }`}
                        >
                          <span className="block font-medium">{RESULT_LABEL[r]}</span>
                          <span className="block text-muted-foreground [overflow-wrap:anywhere]">
                            {RESULT_CONSEQUENCE[r]}
                          </span>
                        </button>
                      ))}
                    </div>
                    {(caseType === "different_branch" ||
                      caseType === "different_business_or_unclear") && (
                      <p className="rounded-control border border-warning-border bg-warning-soft/60 p-3 text-xs [overflow-wrap:anywhere]">
                        A different branch or a different business can never take over this
                        published place. Replacing its identity is unavailable for this case.
                      </p>
                    )}
                  </section>
                )}

                {result && (
                  <section className="space-y-3 min-w-0">
                    <h2 className="text-sm font-semibold">3. Proposed Google listing</h2>
                    <p className="text-[11px] text-muted-foreground">
                      Paste the values from the verified Google listing. Nothing is applied unless
                      you explicitly select it below.
                    </p>

                    <div className="space-y-1.5">
                      <Label htmlFor="gid">Google Place ID</Label>
                      <Input
                        id="gid"
                        value={gid}
                        onChange={(e) => setGid(e.target.value)}
                        placeholder="ChIJ…"
                      />
                      {gidError && <p className="text-[11px] text-destructive">{gidError}</p>}
                      {sameIdentity && (
                        <p className="text-[11px] text-muted-foreground">
                          This is already this place's Google identity — completing the review will
                          record a no-change result.
                        </p>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="pname">Listing name</Label>
                        <Input id="pname" value={pname} onChange={(e) => setPname(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pnb">Area / district</Label>
                        <Input
                          id="pnb"
                          value={pneighborhood}
                          onChange={(e) => setPneighborhood(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="paddr">Listing address</Label>
                      <Input
                        id="paddr"
                        value={paddress}
                        onChange={(e) => setPaddress(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="plat">Latitude</Label>
                        <Input
                          id="plat"
                          inputMode="decimal"
                          value={plat}
                          onChange={(e) => setPlat(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="plng">Longitude</Label>
                        <Input
                          id="plng"
                          inputMode="decimal"
                          value={plng}
                          onChange={(e) => setPlng(e.target.value)}
                        />
                      </div>
                    </div>
                    {coordsInvalid && (
                      <p className="text-[11px] text-destructive">
                        Coordinates must be valid latitude and longitude values.
                      </p>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="pmaps">Google Maps link</Label>
                      <Input id="pmaps" value={pmaps} onChange={(e) => setPmaps(e.target.value)} />
                      {mapsError && <p className="text-[11px] text-destructive">{mapsError}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pweb">Website</Label>
                      <Input id="pweb" value={pweb} onChange={(e) => setPweb(e.target.value)} />
                      {webError && <p className="text-[11px] text-destructive">{webError}</p>}
                    </div>

                    <div className="rounded-control border p-3 space-y-1.5 min-w-0">
                      <p className="text-xs font-medium">Current → proposed</p>
                      <Compare label="Name" current={place.name} proposed={pname} />
                      <Compare label="Address" current={place.address} proposed={paddress} />
                      <Compare label="Area" current={place.neighborhood} proposed={pneighborhood} />
                      <Compare
                        label="Google ID"
                        current={place.google_place_id}
                        proposed={gid}
                      />
                      <Compare label="Website" current={place.website_url} proposed={pweb} />
                      <div className="grid grid-cols-[7rem_1fr] gap-x-2 text-xs">
                        <span className="text-muted-foreground">Distance</span>
                        <span>{formatDistance(dist)}</span>
                      </div>
                    </div>

                    {showNearby && (
                      <div
                        role="note"
                        className="rounded-control border p-3 text-xs space-y-1 [overflow-wrap:anywhere]"
                      >
                        <p className="font-medium">Nearby relocation — {formatDistance(dist)} away</p>
                        <p className="text-muted-foreground">
                          This is close enough to be the same branch moving down the street, but it
                          still needs a primary source: the official listing, website or a statement
                          from the business. The same place record is kept, check-ins start using
                          the new coordinates, and existing Meetups are never cancelled or moved.
                        </p>
                      </div>
                    )}

                    {largeMove && (
                      <div className="rounded-control border border-destructive/50 bg-destructive/5 p-3 text-xs space-y-2 [overflow-wrap:anywhere]">
                        <p className="font-medium text-destructive">
                          {tier === "exceptional"
                            ? `Exceptional distance — ${formatDistance(dist)} away`
                            : `High risk — ${formatDistance(dist)} away`}
                        </p>
                        <p>
                          {tier === "exceptional"
                            ? "A move this far is almost always a different location. Only continue if primary-source evidence proves this exact branch relocated. Another branch can never take over this record."
                            : "A move over 1 km usually means a different location, not the same branch. Continue only with primary-source evidence for this exact branch."}{" "}
                          Existing Meetups here are never cancelled or moved.
                        </p>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="ack-move"
                            className="mt-0.5 h-5 w-5"
                            checked={ackMove}
                            onCheckedChange={(v) => setAckMove(v === true)}
                          />
                          <Label htmlFor="ack-move" className="text-xs font-normal leading-snug">
                            I have verified this distance and confirm it is still the same branch.
                          </Label>
                        </div>
                      </div>
                    )}

                  </section>
                )}

                {result && (
                  <section className="space-y-3 min-w-0">
                    <h2 className="text-sm font-semibold">4. Evidence and confirmations</h2>

                    <div className="space-y-1.5">
                      <Label htmlFor="src">Primary-source link</Label>
                      <Input
                        id="src"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="https://"
                      />
                      {sourceError && <p className="text-[11px] text-destructive">{sourceError}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="sum">Evidence summary</Label>
                      <Textarea
                        id="sum"
                        rows={3}
                        maxLength={1000}
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder="What did you check, and what did it show?"
                      />
                      {summaryError && (
                        <p className="text-[11px] text-destructive">{summaryError}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="note">Internal owner note</Label>
                      <Textarea
                        id="note"
                        rows={2}
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Internal only. Never shown publicly.
                      </p>
                      {noteError && <p className="text-[11px] text-destructive">{noteError}</p>}
                    </div>

                    <fieldset className="rounded-control border p-3 space-y-2 min-w-0">
                      <legend className="px-1 text-xs font-semibold">Identity safety</legend>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="c-business"
                          className="mt-0.5 h-5 w-5"
                          checked={sameBusiness}
                          onCheckedChange={(v) => setSameBusiness(v === true)}
                        />
                        <Label htmlFor="c-business" className="text-xs font-normal leading-snug">
                          The evidence refers to the same business, not a similarly named one
                        </Label>
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="c-branch"
                          className="mt-0.5 h-5 w-5"
                          checked={sameBranch}
                          onCheckedChange={(v) => setSameBranch(v === true)}
                        />
                        <Label htmlFor="c-branch" className="text-xs font-normal leading-snug">
                          The evidence refers to this same branch, not another location
                        </Label>
                      </div>
                      {result === "location_moved" && (
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="c-move"
                            className="mt-0.5 h-5 w-5"
                            checked={relocation}
                            onCheckedChange={(v) => setRelocation(v === true)}
                          />
                          <Label htmlFor="c-move" className="text-xs font-normal leading-snug">
                            The business itself moved — this is not a second location
                          </Label>
                        </div>
                      )}
                    </fieldset>

                    {needsPublicChange && (
                      <fieldset className="rounded-control border p-3 space-y-2 min-w-0">
                        <legend className="px-1 text-xs font-semibold">
                          What should be updated
                        </legend>
                        <p className="text-[11px] text-muted-foreground">
                          Only the fields you select change. The vegan classification, open/closed
                          status, visibility, original verification date and every past visit,
                          Meetup and support count are always preserved.
                        </p>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="a-id"
                            className="mt-0.5 h-5 w-5"
                            checked={applyIdentity}
                            onCheckedChange={(v) => setApplyIdentity(v === true)}
                          />
                          <Label htmlFor="a-id" className="text-xs font-normal leading-snug">
                            Google Place ID and map link
                          </Label>
                        </div>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="a-name"
                            className="mt-0.5 h-5 w-5"
                            checked={applyName}
                            onCheckedChange={(v) => setApplyName(v === true)}
                          />
                          <Label htmlFor="a-name" className="text-xs font-normal leading-snug">
                            Public name
                          </Label>
                        </div>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="a-loc"
                            className="mt-0.5 h-5 w-5"
                            checked={result === "location_moved" ? true : applyLocation}
                            disabled={result === "location_moved"}
                            onCheckedChange={(v) => setApplyLocation(v === true)}
                          />
                          <Label htmlFor="a-loc" className="text-xs font-normal leading-snug">
                            Address, area and coordinates
                            {result === "location_moved" && " (always applied for a relocation)"}
                          </Label>
                        </div>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="a-web"
                            className="mt-0.5 h-5 w-5"
                            checked={applyWebsite}
                            onCheckedChange={(v) => setApplyWebsite(v === true)}
                          />
                          <Label htmlFor="a-web" className="text-xs font-normal leading-snug">
                            Website link
                          </Label>
                        </div>
                      </fieldset>
                    )}

                    {result === "new_branch_required" && (
                      <div className="rounded-control border p-3 space-y-2 text-xs min-w-0">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="a-cand"
                            className="mt-0.5 h-5 w-5"
                            checked={createCandidate}
                            onCheckedChange={(v) => setCreateCandidate(v === true)}
                          />
                          <Label htmlFor="a-cand" className="text-xs font-normal leading-snug">
                            Create a private draft for the new branch
                          </Label>
                        </div>
                        <p className="text-muted-foreground [overflow-wrap:anywhere]">
                          The draft is never public. It must pass its own Google verification and
                          100% vegan review before it can be published.
                        </p>
                      </div>
                    )}

                    {validationError && (
                      <p className="text-[11px] text-destructive [overflow-wrap:anywhere]">
                        {validationError}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={pending || validationError !== null}
                        onClick={openConfirm}
                      >
                        {completeM.isPending ? "Recording…" : "Record identity review"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => cancelM.mutate()}
                      >
                        {cancelM.isPending ? "Cancelling…" : "Cancel review"}
                      </Button>
                    </div>
                  </section>
                )}
              </>
            )}

            {(wsQ.data?.identity_history.length ?? 0) > 0 && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold">Applied identity changes</h2>
                <ul className="space-y-1.5 list-none p-0 m-0">
                  {wsQ.data?.identity_history.map((h) => (
                    <li key={h.id} className="rounded-control border p-3 text-xs space-y-0.5 min-w-0">
                      <p className="font-medium">
                        {formatIdentityDate(h.changed_at)} —{" "}
                        {IDENTITY_ACTION_LABEL[h.action] ?? h.action}
                      </p>
                      <Row label="Google ID">
                        {(h.old_google_place_id ?? "—") + " → " + (h.new_google_place_id ?? "—")}
                      </Row>
                      <Row label="Address">
                        {(h.old_address ?? "—") + " → " + (h.new_address ?? "—")}
                      </Row>
                      {h.internal_reason && <Row label="Note">{h.internal_reason}</Row>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(wsQ.data?.history.length ?? 0) > 0 && (
              <section className="space-y-2 min-w-0">
                <h2 className="text-sm font-semibold">Identity review history</h2>
                <ul className="space-y-1.5 list-none p-0 m-0">
                  {wsQ.data?.history.map((h) => (
                    <li key={h.id} className="rounded-control border p-3 text-xs space-y-0.5 min-w-0">
                      <p className="font-medium">
                        {formatIdentityDate(h.completed_at ?? h.started_at)} —{" "}
                        {IDENTITY_RESULT_LABEL[h.result ?? ""] ?? h.result ?? h.status}
                      </p>
                      {h.case_type && (
                        <Row label="Case">
                          {CASE_TYPE_LABEL[h.case_type as IdentityCaseType] ?? h.case_type}
                        </Row>
                      )}
                      <Row label="Applied">{h.public_action_applied ? "Yes" : "No"}</Row>
                      {h.distance_meters != null && (
                        <Row label="Distance">{formatDistance(h.distance_meters)}</Row>
                      )}
                      {h.official_source_url && (
                        <Row label="Evidence">
                          <a
                            href={h.official_source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary [overflow-wrap:anywhere]"
                          >
                            {h.official_source_url}
                          </a>
                        </Row>
                      )}
                      {h.owner_note && <Row label="Note">{h.owner_note}</Row>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => (o ? setConfirmOpen(true) : closeConfirm())}
      >
        <AlertDialogContent className="max-w-[min(92vw,32rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              {result === "identity_replaced"
                ? `Replace the Google identity of ${place?.name ?? "this place"}?`
                : result === "location_moved"
                  ? `Record a relocation for ${place?.name ?? "this place"}?`
                  : "Record this identity review?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                {needsPublicChange ? (
                  <ul className="list-disc pl-4 space-y-1">
                    <li>
                      The same Community Place record is kept — the same place ID{" "}
                      <span className="[overflow-wrap:anywhere]">{place?.id}</span> and the same
                      verified candidate record. Nothing is duplicated or deleted.
                    </li>
                    {gid.trim() !== "" && applyIdentity && !sameIdentity && (
                      <>
                        <li className="[overflow-wrap:anywhere]">
                          Google Place ID: {place?.google_place_id ?? "—"} → {gid.trim()}
                        </li>
                        <li>
                          The public Google Maps link changes to the new listing. The old map link
                          stops being shown to members.
                        </li>
                      </>
                    )}

                    <li>
                      Updated:{" "}
                      {[
                        applyIdentity && "Google identity",
                        applyName && "public name",
                        (applyLocation || result === "location_moved") && "address and coordinates",
                        applyWebsite && "website",
                      ]
                        .filter(Boolean)
                        .join(", ") || "nothing selected"}
                      .
                    </li>
                    <li>
                      Vegan classification, open/closed status, visibility and the original
                      verification date are unchanged.
                    </li>
                    <li>
                      Past visits, Meetups, support counts and member history stay with this place.
                    </li>
                    <li>Existing Meetups are never cancelled or moved.</li>
                    {dist != null && <li>Distance from the current location: {formatDistance(dist)}.</li>}
                  </ul>
                ) : (
                  <p>{result ? RESULT_CONSEQUENCE[result] : ""}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                closeConfirm();
                completeM.mutate();
              }}
            >
              {needsPublicChange ? "Apply identity change" : "Record review"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
