import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, Search as SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  fetchPlaceCandidates,
  isOwner,
  rejectCandidate,
  saveCandidateDraft,
  searchGooglePlaces,
  verifyAndPublishCandidate,
  type GoogleCandidate,
  type PlaceCandidate,
} from "@/lib/placeVerification";
import {
  hasGoogleVerification,
  INCOMPLETE_GOOGLE_RESULT_MESSAGE,
  publishBlockers,
  toGoogleIdentityPatch,
} from "@/lib/candidatePublish";


const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  verified: "Verified",
  published: "Published",
  rejected: "Rejected",
};


export default function OwnerPlaceVerification() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [googleResults, setGoogleResults] = useState<GoogleCandidate[] | null>(null);
  const [form, setForm] = useState<Partial<PlaceCandidate>>({});

  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });
  const candidatesQ = useQuery({
    queryKey: ["place-candidates"],
    queryFn: fetchPlaceCandidates,
    enabled: ownerQ.data === true,
  });

  const selected = useMemo(
    () => candidatesQ.data?.find((c) => c.id === selectedId) ?? null,
    [candidatesQ.data, selectedId],
  );
  const merged: PlaceCandidate | null = selected ? { ...selected, ...form } : null;

  const searchM = useMutation({
    mutationFn: () => searchGooglePlaces(query),
    onSuccess: (r) => {
      setGoogleResults(r);
      if (r.length === 0) toast.info("No Google Places matches for that search.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveM = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      await saveCandidateDraft(selected.id, form);
    },
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["place-candidates"] });
      toast.success("Draft saved. Nothing is public yet.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * WO-104 DEF-104-01 — "Verify & publish" runs the full lifecycle
   * (draft/needs_review → verified → published) through ONE owner-only,
   * transactional server RPC. The client never writes verification_status.
   */
  const publishM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No candidate selected");
      if (Object.keys(form).length > 0) await saveCandidateDraft(selected.id, form);
      return verifyAndPublishCandidate(selected.id);
    },
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["place-candidates"] });
      toast.success("Published to Community Places.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No candidate selected");
      return rejectCandidate(selected.id, (form.verification_notes ?? selected.verification_notes) || undefined);
    },
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["place-candidates"] });
      toast.success("Candidate rejected.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * WO-103 DEF-103-01 — confirming a Google result imports the verified
   * identity/location fields AND persists them immediately, so the owner never
   * handles raw coordinates. Curated VeggieMeet copy is untouched: only the
   * Google-managed columns are written, and unsaved curated edits in `form`
   * are preserved.
   */
  const confirmGoogleM = useMutation({
    mutationFn: async (g: GoogleCandidate) => {
      if (!selected) throw new Error("No candidate selected");
      const patch = toGoogleIdentityPatch(g);
      if (!patch) throw new Error(INCOMPLETE_GOOGLE_RESULT_MESSAGE);
      await saveCandidateDraft(selected.id, patch as Partial<PlaceCandidate>);
      return patch;
    },
    onSuccess: async (patch) => {
      // Drop stale Google keys from the local draft so the saved values win.
      setForm((f) => {
        const next = { ...f };
        for (const k of Object.keys(patch)) delete next[k as keyof PlaceCandidate];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["place-candidates"] });
      setGoogleResults(null);
      toast.success("Google place confirmed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  if (ownerQ.isLoading) {
    return <div className="flex-1 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (ownerQ.data !== true) {
    return (
      <div className="flex-1 grid place-items-center p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Permission denied</h1>
          <p className="text-sm text-muted-foreground">This area is limited to the VeggieMeet owner.</p>
          <Button variant="outline" onClick={() => navigate("/")}>Back to Today</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="space-y-6">
        {/* Candidate curation only. Suggestions, reports, maintenance and
            reverification live in their own tabs of the operations dashboard,
            so they are intentionally not repeated here. */}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Candidates ({candidatesQ.data?.length ?? 0})</h2>
          {candidatesQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          <ul className="space-y-1.5">
            {(candidatesQ.data ?? []).map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    setSelectedId(c.id === selectedId ? null : c.id);
                    setForm({});
                    setGoogleResults(null);
                    setQuery(c.display_name);
                  }}
                  className={`w-full text-left rounded-control border p-3 transition-colors ${
                    c.id === selectedId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{c.display_name}</span>
                    <span className="text-[11px] shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {STATUS_LABEL[c.verification_status] ?? c.verification_status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.district ?? "—"} · {c.category ?? "no category"}
                    {c.google_place_id ? " · Place ID set" : " · no Place ID"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {merged && (
          <>
            {/* ---- Google search ---- */}
            <section className="space-y-2 min-w-0">
              <h2 className="text-sm font-semibold">Step 1 — Verify against Google Places</h2>
              {hasGoogleVerification(merged) && (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Google place confirmed
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name and city, e.g. Hum Vegetarian Ho Chi Minh City"
                  aria-label="Search Google Places by business name and city"
                  onKeyDown={(e) => e.key === "Enter" && searchM.mutate()}
                />
                <Button
                  onClick={() => searchM.mutate()}
                  disabled={searchM.isPending || query.trim().length < 2}
                  aria-label="Search Google Places"
                >
                  {searchM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only Place ID, name, address, coordinates, Maps link, status, type and website are retrieved.
                Reviews, ratings and photos are never requested or stored.
              </p>
              <p className="sr-only" role="status">
                {searchM.isPending
                  ? "Searching Google Places…"
                  : confirmGoogleM.isPending
                    ? "Confirming this place and importing verified details…"
                    : ""}
              </p>
              {googleResults?.map((g) => {
                const confirming = confirmGoogleM.isPending && confirmGoogleM.variables?.place_id === g.place_id;
                return (
                  <div key={g.place_id} className="rounded-control border p-3 space-y-1 min-w-0">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">{g.display_name}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{g.formatted_address}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.business_status ?? "status unknown"} · {g.primary_type ?? "type unknown"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => confirmGoogleM.mutate(g)}
                        disabled={confirmGoogleM.isPending}
                      >
                        {confirming ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Confirming…
                          </>
                        ) : (
                          "Use this place"
                        )}
                      </Button>
                      {g.google_maps_url && (
                        <a
                          href={g.google_maps_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary inline-flex items-center gap-1"
                        >
                          View on Google Maps <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>


            {/* ---- Curation form ---- */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Step 2 — Review VeggieMeet copy</h2>
              <div className="space-y-1.5">
                <Label htmlFor="pv-name">Display name (internal)</Label>
                <Input
                  id="pv-name"
                  value={merged.display_name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                />
                <Label htmlFor="pv-public-name">Approved public display name</Label>
                <Input
                  id="pv-public-name"
                  value={merged.public_display_name ?? ""}
                  placeholder="Leave empty to use the internal name"
                  onChange={(e) => setForm((f) => ({ ...f, public_display_name: e.target.value }))}
                />
                <Label htmlFor="pv-public-address">Approved public address</Label>
                <Input
                  id="pv-public-address"
                  value={merged.public_address ?? ""}
                  placeholder="Leave empty to use the verified Google address"
                  onChange={(e) => setForm((f) => ({ ...f, public_address: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pv-cat">Category</Label>
                  <Input
                    id="pv-cat"
                    value={merged.category ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="restaurant, cafe, park…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pv-district">District</Label>
                  <Input
                    id="pv-district"
                    value={merged.district ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pv-class">Vegan / vegetarian classification</Label>
                <Input
                  id="pv-class"
                  value={merged.veggie_classification ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, veggie_classification: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pv-reason">Veggie-friendly reason</Label>
                <Textarea
                  id="pv-reason"
                  rows={2}
                  value={merged.veggie_reason ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, veggie_reason: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pv-desc">Original description (VeggieMeet copy only)</Label>
                <Textarea
                  id="pv-desc"
                  rows={4}
                  value={merged.description ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pv-img">Cover image URL (licensed only)</Label>
                  <Input
                    id="pv-img"
                    value={merged.cover_image_url ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, cover_image_url: e.target.value || null }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pv-rights">Image rights</Label>
                  <Input
                    id="pv-rights"
                    value={merged.image_rights_status ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, image_rights_status: e.target.value }))}
                    placeholder="none | cleared | no_image | pending"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pv-notes">Verification notes</Label>
                <Textarea
                  id="pv-notes"
                  rows={3}
                  value={merged.verification_notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, verification_notes: e.target.value }))}
                />
              </div>

              {/* WO-103: owner-facing identity first; Place ID and coordinates
                  are system data kept only for operational transparency. */}
              <div className="rounded-control bg-muted/50 p-3 text-xs space-y-1 min-w-0">
                <p className="font-medium">
                  {hasGoogleVerification(merged) ? "Google place confirmed" : "Google place not confirmed yet"}
                </p>
                <p className="text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">
                  {merged.google_display_name ?? "—"}
                </p>
                <p className="[overflow-wrap:anywhere]">{merged.google_formatted_address ?? "—"}</p>
                <p>Status: {merged.business_status ?? "—"}</p>
                {merged.google_maps_url && (
                  <a
                    href={merged.google_maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-1"
                  >
                    View on Google Maps <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <details className="pt-1">
                  <summary className="cursor-pointer text-muted-foreground">System verification data</summary>
                  <p className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">
                    Place ID: {merged.google_place_id ?? "—"}
                  </p>
                  <p className="text-muted-foreground">
                    Coordinates:{" "}
                    {merged.latitude != null && merged.longitude != null
                      ? `${merged.latitude}, ${merged.longitude}`
                      : "—"}
                  </p>
                </details>
                <p className="text-muted-foreground pt-1">
                  Place data © Google. Ratings, reviews and photos are not stored.
                </p>
              </div>

              {publishBlockers(merged).length > 0 && (
                <div
                  role="alert"
                  className="rounded-control border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1"
                >
                  <p className="font-medium text-destructive">Not publishable yet</p>
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {publishBlockers(merged).map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              )}

              <h2 className="text-sm font-semibold pt-1">Step 3 — Verify &amp; publish</h2>
              <p className="text-[11px] text-muted-foreground">
                One action marks this candidate verified and publishes it to Community Places.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
                  Save draft
                </Button>
                <Button
                  onClick={() => publishM.mutate()}
                  aria-label="Verify and publish this candidate to Community Places"
                  disabled={publishM.isPending || confirmGoogleM.isPending || publishBlockers(merged).length > 0}
                >
                  {publishM.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verifying &amp; publishing…
                    </>
                  ) : (
                    "Verify & publish"
                  )}
                </Button>

                <Button variant="ghost" onClick={() => rejectM.mutate()} disabled={rejectM.isPending}>
                  Reject
                </Button>
              </div>
              <p className="sr-only" role="status">
                {publishM.isPending
                  ? "Verifying and publishing this candidate…"
                  : publishM.isSuccess
                    ? "Published to Community Places."
                    : ""}
              </p>
              {publishM.isError && (
                <p role="alert" className="text-xs text-destructive">
                  {(publishM.error as Error).message}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
