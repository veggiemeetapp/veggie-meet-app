import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, PencilLine } from "lucide-react";
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
import { isOwner, fetchGooglePlaceDetails, type GoogleCandidate } from "@/lib/placeVerification";
import { MAINTENANCE_STATUS_LABEL } from "@/lib/placeMaintenance";
import { REPORT_REASON_LABEL, type PlaceReportReason } from "@/lib/placeReports";
import { formatDate } from "@/lib/placeReverification";
import {
  CATEGORY_OPTIONS,
  EDITABLE_FIELDS,
  FAILURE_COPY,
  FIELD_LABEL,
  RISK_COPY,
  SOURCE_OPTIONS,
  changedFields,
  currentValue,
  distanceMeters,
  fetchEditWorkspace,
  formFromPlace,
  proposedValue,
  updatePlaceDetails,
  type DetailChangeSource,
  type DetailForm,
  type EditableField,
} from "@/lib/placeDetailEdit";
import type { CommunityPlaceMaintenanceStatus } from "@/types";

const CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian friendly",
  vegan_options: "Vegan options",
  not_food: "Community space",
};

/** Google-observed fields the owner may selectively apply to the form. */
const GOOGLE_APPLY: Array<{
  key: keyof DetailForm | "coordinates";
  label: string;
  read: (g: GoogleCandidate) => string | null;
}> = [
  { key: "name", label: "Display name", read: (g) => g.display_name },
  { key: "address", label: "Formatted address", read: (g) => g.formatted_address },
  { key: "website_url", label: "Official website", read: (g) => g.website_url },
  { key: "google_maps_url", label: "Google Maps link", read: (g) => g.google_maps_url },
  {
    key: "coordinates",
    label: "Coordinates",
    read: (g) =>
      g.latitude == null || g.longitude == null ? null : `${g.latitude}, ${g.longitude}`,
  },
];

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * WO-057 — Owner-only workspace for correcting the PUBLIC details of an
 * existing published Community Place.
 *
 * This edits the existing row: the same community place ID keeps every Meetup,
 * visit, report and supported-place record attached to it. Google Place ID,
 * vegan classification, verification status, active state and maintenance
 * status are NOT parameters of the update RPC, so this workflow cannot change
 * them — operational and activation changes stay in WO-053/WO-055, and vegan
 * decisions stay in the verification workflow.
 */
export default function OwnerPlaceEditDetails() {
  const { placeId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const entrySource = params.get("from") ?? "owner_places";
  const relatedReportId = params.get("report");
  const relatedReverificationId = params.get("reverification");

  const [form, setForm] = useState<DetailForm | null>(null);
  const [source, setSource] = useState<DetailChangeSource>(
    relatedReportId ? "member_report" : relatedReverificationId ? "reverification" : "owner_review",
  );
  const [note, setNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [ackRisk, setAckRisk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [google, setGoogle] = useState<GoogleCandidate | null>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });
  const wsQ = useQuery({
    queryKey: ["place-edit-workspace", placeId],
    queryFn: () => fetchEditWorkspace(placeId),
    enabled: ownerQ.data === true && !!placeId,
  });

  const place = wsQ.data?.place ?? null;

  // Seed the proposed values from the current row once it arrives.
  useEffect(() => {
    if (place && form === null) setForm(formFromPlace(place));
  }, [place, form]);

  useEffect(() => {
    if (place) {
      logAnalyticsEvent("community_place_edit_opened", { source: entrySource });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id]);

  useEffect(() => {
    if (errorMsg) errorRef.current?.focus();
  }, [errorMsg]);

  const changed = useMemo(
    () => (place && form ? changedFields(place, form) : []),
    [place, form],
  );

  const moved = useMemo(() => {
    if (!place || !form || !changed.includes("coordinates")) return null;
    const lat = form.latitude.trim() === "" ? null : Number(form.latitude);
    const lon = form.longitude.trim() === "" ? null : Number(form.longitude);
    return distanceMeters(place.latitude, place.longitude, lat, lon);
  }, [place, form, changed]);

  const googleM = useMutation({
    mutationFn: () => {
      const gid = place?.google_place_id;
      if (!gid) throw new Error("This place has no Google Place ID.");
      return fetchGooglePlaceDetails(gid);
    },
    onSuccess: (g) => {
      setGoogle(g);
      const available = GOOGLE_APPLY.filter((f) => f.read(g)).length;
      logAnalyticsEvent("community_place_edit_google_checked", {
        fields_available_count: available,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveM = useMutation({
    mutationFn: () => {
      if (!place || !form) throw new Error("Nothing to save.");
      return updatePlaceDetails({
        placeId: place.id,
        form,
        source,
        internalNote: note,
        officialSourceUrl: evidenceUrl.trim() || null,
        sourceReferenceId:
          source === "member_report"
            ? relatedReportId
            : source === "reverification"
              ? relatedReverificationId
              : null,
        acknowledgeIdentityRisk: ackRisk,
      });
    },
    onSuccess: (r) => {
      setConfirming(false);
      if (!r.ok) {
        const base = FAILURE_COPY[r.reason ?? ""] ?? "That update couldn't be saved.";
        const detail = (r.risks ?? []).map((k) => RISK_COPY[k] ?? k).join(" ");
        setErrorMsg(detail ? `${base} ${detail}` : base);
        setSuccessMsg(null);
        logAnalyticsEvent("community_place_edit_blocked", { reason: r.reason ?? "unknown" });
        return;
      }
      logAnalyticsEvent("community_place_edit_completed", {
        changed_fields: r.changed_fields ?? [],
        source,
      });
      setErrorMsg(null);
      setNote("");
      setEvidenceUrl("");
      setAckRisk(false);
      setGoogle(null);
      setForm(null);
      setSuccessMsg(
        `Public details updated: ${(r.changed_fields ?? [])
          .map((f) => FIELD_LABEL[f as EditableField] ?? f)
          .join(", ")}. The vegan classification, operational status and Google identity are unchanged.`,
      );
      toast.success("Public place details updated.");
      qc.invalidateQueries({ queryKey: ["place-edit-workspace", placeId] });
      qc.invalidateQueries({ queryKey: ["place-maintenance"] });
      qc.invalidateQueries({ queryKey: ["maintenance-places"] });
      qc.invalidateQueries({ queryKey: ["reverification-queue"] });
      qc.invalidateQueries({ queryKey: ["place-report-queue"] });
      qc.invalidateQueries({ queryKey: ["community-places"] });
      qc.invalidateQueries({ queryKey: ["community-place"] });
      qc.invalidateQueries({ queryKey: ["published-places-all"] });
      qc.invalidateQueries({ queryKey: ["host-published-places"] });
    },
    onError: (e: Error) => {
      setConfirming(false);
      setErrorMsg(e.message);
    },
  });

  if (ownerQ.isLoading) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
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

  const noteInvalid = note.trim().length === 0 || note.trim().length > 500;
  const canPreview = changed.length > 0 && !noteInvalid;

  return (
    <div className="flex-1 flex flex-col pb-28">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => safeBack(navigate, "/owner/places")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">Edit place details</h1>
          <p className="text-xs text-muted-foreground">
            Update verified public information for this existing Community Place.
          </p>
        </div>
      </header>

      <div aria-live="polite" className="sr-only">
        {successMsg ?? ""}
      </div>

      {wsQ.isPending && (
        <div className="p-4">
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        </div>
      )}
      {wsQ.isError && (
        <p className="p-4 text-sm text-destructive">{(wsQ.error as Error).message}</p>
      )}

      {place && form && (
        <div className="mx-auto w-full max-w-3xl min-w-0 space-y-5 p-4">
          {/* ---- Place identity summary ---- */}
          <section className="min-w-0 space-y-2 rounded-lg border p-3">
            <h2 className="text-sm font-semibold [overflow-wrap:anywhere]">{place.name}</h2>
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              <Meta label="Visibility">{place.is_active ? "Active" : "Archived"}</Meta>
              <Meta label="Operational status">
                {MAINTENANCE_STATUS_LABEL[
                  place.maintenance_status as CommunityPlaceMaintenanceStatus
                ] ?? place.maintenance_status}
              </Meta>
              <Meta label="Classification">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {CLASSIFICATION_LABEL[place.veggie_classification ?? ""] ??
                    place.veggie_classification ??
                    "—"}
                  <span className="text-muted-foreground">(locked)</span>
                  {/* WO-058 — vegan status only ever changes in its own workflow. */}
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2"
                    onClick={() =>
                      navigate(`/owner/places/${placeId}/vegan-review?source=place_edit`)
                    }
                  >
                    Review vegan status
                  </button>
                </span>
              </Meta>

              <Meta label="Google Place ID">
                {place.has_google_place_id ? "Present (locked)" : "Not set"}
              </Meta>
              <Meta label="Verified">{formatDate(place.verified_at)}</Meta>
              <Meta label="Last reverified">{formatDate(place.last_reverified_at)}</Meta>
            </dl>
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs [overflow-wrap:anywhere]">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
              This updates the existing public place. It does not create a new place or change its
              vegan or operational status.
            </p>
          </section>

          {successMsg && (
            <p className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs [overflow-wrap:anywhere]">
              {successMsg}
              {relatedReportId && (
                <>
                  {" "}
                  The member report is still open — resolve or dismiss it in the report queue.
                </>
              )}
              {relatedReverificationId && (
                <>
                  {" "}
                  The detail correction is complete. The reverification record is unchanged and the
                  place is not marked Confirmed current.
                </>
              )}
            </p>
          )}

          {errorMsg && (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive [overflow-wrap:anywhere]"
            >
              {errorMsg}
            </div>
          )}

          {/* ---- Related context ---- */}
          {wsQ.data && wsQ.data.open_reports.length > 0 && (
            <section className="min-w-0 space-y-1 rounded-lg border p-3">
              <h2 className="text-sm font-semibold">Open member reports</h2>
              <ul className="m-0 list-none space-y-1 p-0">
                {wsQ.data.open_reports.map((r) => (
                  <li key={r.id} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {REPORT_REASON_LABEL[r.reason_code as PlaceReportReason] ?? r.reason_code} —{" "}
                    {r.explanation}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Editing details never resolves a report and never notifies the reporter. Resolve or
                dismiss it in the report queue.
              </p>
            </section>
          )}

          {/* ---- A. Identity and location ---- */}
          <Group title="Identity and location">
            <Field
              id="ed-name"
              label={FIELD_LABEL.name}
              current={currentValue(place, "name")}
              changedNow={changed.includes("name")}
            >
              <Input
                id="ed-name"
                value={form.name}
                maxLength={160}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              id="ed-address"
              label={FIELD_LABEL.address}
              current={currentValue(place, "address")}
              changedNow={changed.includes("address")}
            >
              <Textarea
                id="ed-address"
                rows={2}
                maxLength={300}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field
              id="ed-area"
              label={FIELD_LABEL.neighborhood}
              current={currentValue(place, "neighborhood")}
              changedNow={changed.includes("neighborhood")}
              hint={place.city_name ? `Must stay within ${place.city_name}.` : undefined}
            >
              <Input
                id="ed-area"
                value={form.neighborhood}
                maxLength={120}
                onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="ed-lat"
                label="Latitude"
                current={place.latitude == null ? "—" : String(place.latitude)}
                changedNow={changed.includes("coordinates")}
              >
                <Input
                  id="ed-lat"
                  inputMode="decimal"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                />
              </Field>
              <Field
                id="ed-lon"
                label="Longitude"
                current={place.longitude == null ? "—" : String(place.longitude)}
                changedNow={changed.includes("coordinates")}
              >
                <Input
                  id="ed-lon"
                  inputMode="decimal"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                />
              </Field>
            </div>
            {moved != null && (
              <p className="text-xs text-amber-700 [overflow-wrap:anywhere]">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                Coordinates move approximately {moved} m. Moves over 1 km are blocked as a possible
                different business.
              </p>
            )}
          </Group>

          {/* ---- B. Classification ---- */}
          <Group title="Classification">
            <Field
              id="ed-cat"
              label={FIELD_LABEL.category}
              current={currentValue(place, "category")}
              changedNow={changed.includes("category")}
              hint="Place type follows the category. The vegan classification can't be changed here."
            >
              <select
                id="ed-cat"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </Group>

          {/* ---- C. Public links ---- */}
          <Group title="Public links">
            <Field
              id="ed-site"
              label={FIELD_LABEL.website_url}
              current={currentValue(place, "website_url")}
              changedNow={changed.includes("website_url")}
              hint="http:// or https:// only."
            >
              <Input
                id="ed-site"
                value={form.website_url}
                maxLength={500}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              />
            </Field>
            <Field
              id="ed-maps"
              label={FIELD_LABEL.google_maps_url}
              current={currentValue(place, "google_maps_url")}
              changedNow={changed.includes("google_maps_url")}
              hint="Must be a Google Maps address."
            >
              <Input
                id="ed-maps"
                value={form.google_maps_url}
                maxLength={500}
                onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })}
              />
            </Field>
          </Group>

          {/* ---- D. Public description ---- */}
          <Group title="Public description">
            <Field
              id="ed-desc"
              label={FIELD_LABEL.description}
              current={currentValue(place, "description")}
              changedNow={changed.includes("description")}
              hint="Original VeggieMeet copy only. Never Google editorial content."
            >
              <Textarea
                id="ed-desc"
                rows={4}
                maxLength={1000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
          </Group>

          {/* ---- Google comparison ---- */}
          <Group title="Check Google details">
            <p className="text-xs text-muted-foreground">
              Uses this place's existing Google Place ID. Only name, address, coordinates, Maps
              link, business status, primary type and website are requested — never reviews,
              ratings, photos, editorial summaries or opening hours. Nothing is applied
              automatically.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!place.has_google_place_id || googleM.isPending}
              aria-label="Check this place against Google Places using its existing Place ID"
              onClick={() => googleM.mutate()}
            >
              {googleM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                "Check Google details"
              )}
            </Button>
            {google && (
              <ul className="m-0 min-w-0 list-none space-y-2 p-0">
                {GOOGLE_APPLY.map((g) => {
                  const observed = g.read(google);
                  return (
                    <li key={String(g.key)} className="min-w-0 rounded-md border p-2 text-xs">
                      <p className="font-medium">{g.label}</p>
                      <p className="[overflow-wrap:anywhere] text-muted-foreground">
                        VeggieMeet:{" "}
                        {g.key === "coordinates"
                          ? currentValue(place, "coordinates")
                          : currentValue(place, g.key as EditableField)}
                      </p>
                      <p className="[overflow-wrap:anywhere] text-muted-foreground">
                        Google: {observed ?? "—"}
                      </p>
                      {observed && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 px-2"
                          aria-label={`Apply the Google-observed ${g.label.toLowerCase()} to the proposed value`}
                          onClick={() => {
                            if (g.key === "coordinates") {
                              setForm({
                                ...form,
                                latitude: String(google.latitude ?? ""),
                                longitude: String(google.longitude ?? ""),
                              });
                            } else {
                              setForm({ ...form, [g.key]: observed } as DetailForm);
                            }
                          }}
                        >
                          Apply to proposed
                        </Button>
                      )}
                    </li>
                  );
                })}
                <li className="text-[11px] text-muted-foreground">
                  Google business status: {google.business_status ?? "—"} · primary type:{" "}
                  {google.primary_type ?? "—"}. Place data © Google. The existing Google Place ID
                  never changes.
                </li>
              </ul>
            )}
          </Group>

          {/* ---- E. Change reason ---- */}
          <Group title="Change reason (private)">
            <div className="space-y-1.5">
              <Label htmlFor="ed-source">Source of this correction</Label>
              <select
                id="ed-source"
                value={source}
                onChange={(e) => setSource(e.target.value as DetailChangeSource)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-note">Internal note (required)</Label>
              <Textarea
                id="ed-note"
                rows={2}
                maxLength={500}
                value={note}
                aria-describedby="ed-note-hint"
                onChange={(e) => setNote(e.target.value)}
                placeholder="What evidence supports this correction?"
              />
              <p id="ed-note-hint" className="text-[11px] text-muted-foreground">
                Private. Never shown publicly. {note.trim().length}/500.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-evidence">Official source link (optional)</Label>
              <Input
                id="ed-evidence"
                value={evidenceUrl}
                maxLength={500}
                aria-describedby="ed-evidence-hint"
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://"
              />
              <p id="ed-evidence-hint" className="text-[11px] text-muted-foreground">
                Stored privately in the audit record. Never shown on the public place, and never
                treated as proof of vegan status.
              </p>
            </div>
            {(relatedReportId || relatedReverificationId) && (
              <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                Linked to the {relatedReportId ? "member report" : "reverification"} you came from.
              </p>
            )}
          </Group>

          {/* ---- Changed summary ---- */}
          <section className="min-w-0 space-y-1 rounded-lg border p-3">
            <h2 className="text-sm font-semibold">
              Changed fields ({changed.length})
            </h2>
            {changed.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No changes yet. An update with nothing changed is refused.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0 text-xs">
                {changed.map((f) => (
                  <li key={f} className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">Changed · {FIELD_LABEL[f]}:</span>{" "}
                    {currentValue(place, f)} → {proposedValue(form, f)}
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 flex items-start gap-2 text-xs">
              <Checkbox
                id="ed-ack"
                checked={ackRisk}
                onCheckedChange={(v) => setAckRisk(v === true)}
              />
              <span>
                I confirm this is a correction to the same business, not a different place.
                Required when a name, address or coordinate change is significant.
              </span>
            </label>
            <Button
              className="mt-2"
              disabled={!canPreview || saveM.isPending}
              onClick={(e) => {
                confirmTriggerRef.current = e.currentTarget;
                logAnalyticsEvent("community_place_edit_previewed", {
                  changed_field_count: changed.length,
                  source,
                });
                setConfirming(true);
              }}
            >
              <PencilLine className="mr-1.5 h-4 w-4" aria-hidden />
              Review and update
            </Button>
            {changed.length > 0 && noteInvalid && (
              <p className="text-xs text-destructive">
                Add an internal note (up to 500 characters) before updating.
              </p>
            )}
          </section>

          {/* ---- Detail change history ---- */}
          {wsQ.data && wsQ.data.history.length > 0 && (
            <section className="min-w-0 space-y-1 rounded-lg border p-3">
              <h2 className="text-sm font-semibold">Detail change history (private)</h2>
              <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground">
                {wsQ.data.history.map((h) => (
                  <li key={h.id} className="min-w-0 [overflow-wrap:anywhere]">
                    {new Date(h.changed_at).toLocaleString()} —{" "}
                    {h.changed_fields
                      .map((f) => FIELD_LABEL[f as EditableField] ?? f)
                      .join(", ")}{" "}
                    ({h.source.replace(/_/g, " ")}): {h.internal_note}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ---- Confirmation preview ---- */}
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o && !saveM.isPending) {
            setConfirming(false);
            const el = confirmTriggerRef.current;
            if (el?.isConnected) requestAnimationFrame(() => el.focus());
          }
        }}
      >
        <AlertDialogContent className="max-h-[85vh] max-w-[min(92vw,34rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              Update public place details?
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              <span className="block font-medium text-foreground">{place?.name}</span>
              <span className="mt-2 block">
                The existing Community Place record is updated. Its Google Place ID, 100% Vegan
                classification, operational status and active state do not change.
              </span>
              {place && form && (
                <span className="mt-2 block space-y-1">
                  {changed.map((f) => (
                    <span key={f} className="block">
                      <strong>{FIELD_LABEL[f]}</strong>: {currentValue(place, f)} →{" "}
                      {proposedValue(form, f)}
                    </span>
                  ))}
                </span>
              )}
              {moved != null && (
                <span className="mt-2 block">
                  Coordinates move from {place?.latitude}, {place?.longitude} to{" "}
                  {form?.latitude}, {form?.longitude} — approximately {moved} m.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saveM.isPending}
              onClick={(e) => {
                e.preventDefault();
                saveM.mutate();
              }}
            >
              {saveM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                "Update public details"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Current value + proposed input. "Changed" is announced in text, never colour-only. */
function Field({
  id,
  label,
  current,
  changedNow,
  hint,
  children,
}: {
  id: string;
  label: string;
  current: string;
  changedNow: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {changedNow && (
          <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            Changed
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
        Current: {current}
      </p>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
