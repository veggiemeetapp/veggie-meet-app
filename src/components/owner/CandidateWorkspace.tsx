import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, ExternalLink, Loader2, Search as SearchIcon } from "lucide-react";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMAGE_RIGHTS_OPTIONS,
  PLACE_CATEGORIES,
  VEGGIE_CLASSIFICATIONS,
  mapCandidateConstraintError,
  validateCandidatePatch,
} from "@/lib/candidateVocabulary";
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
  isPublishedCandidate,
  publishBlockers,
  toGoogleIdentityPatch,
} from "@/lib/candidatePublish";
import {
  CANDIDATE_GROUP_DEFAULT_OPEN,
  CANDIDATE_GROUP_EMPTY,
  groupCandidates,
  groupCountLabel,
  type CandidateGroup,
  type CandidateGroupKey,
} from "@/lib/candidateGrouping";
import { useActiveCities } from "@/hooks/useLocation";



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
      // WO-108: never send a value the database vocabulary rejects.
      const invalid = validateCandidatePatch(form);
      if (invalid) throw new Error(invalid);
      await saveCandidateDraft(selected.id, form);
    },
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["place-candidates"] });
      toast.success("Draft saved. Nothing is public yet.");
    },
    onError: (e: Error) => toast.error(mapCandidateConstraintError(e.message)),
  });

  /**
   * WO-104 DEF-104-01 — "Verify & publish" runs the full lifecycle
   * (draft/needs_review → verified → published) through ONE owner-only,
   * transactional server RPC. The client never writes verification_status.
   */
  const publishM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No candidate selected");
      const invalid = validateCandidatePatch(form);
      if (invalid) throw new Error(invalid);
      if (Object.keys(form).length > 0) await saveCandidateDraft(selected.id, form);
      return verifyAndPublishCandidate(selected.id);
    },
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["place-candidates"] });
      toast.success("Published to Community Places.");
    },
    // Lifecycle copy (WO-104) is already owner-safe; only raw DB vocabulary
    // violations are re-mapped here.
    onError: (e: Error) =>
      toast.error(
        /violates|constraint|invalid input value for enum/i.test(e.message)
          ? mapCandidateConstraintError(e.message)
          : e.message,
      ),

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

        {/* WO-128 — status-grouped collapsible sections + candidate search so
            the queue stays compact as candidate records accumulate. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Candidates ({candidatesQ.data?.length ?? 0})
            </h2>
            {searching && (
              <p className="text-[11px] text-muted-foreground">
                {totalMatches} {totalMatches === 1 ? "match" : "matches"}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pv-candidate-search" className="sr-only">
              Search candidates
            </Label>
            <div className="flex items-center gap-2 min-w-0">
              <Input
                id="pv-candidate-search"
                type="search"
                value={candidateSearch}
                onChange={(e) => setCandidateSearch(e.target.value)}
                placeholder="Search candidates"
                className="min-w-0"
              />
              {searching && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCandidateSearch("")}
                  aria-label="Clear candidate search"
                >
                  Clear
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Searches name, address, district, city, category and Place ID across every status.
            </p>
          </div>

          {candidatesQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {searching && totalMatches === 0 && (
            <p role="status" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              No candidates match “{candidateSearch.trim()}”.
            </p>
          )}

          <div className="space-y-2">
            {groups.map((g) => {
              const open = isGroupOpen(g);
              return (
                <div key={g.key} className="rounded-control border min-w-0">
                  <h3>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={open}
                      aria-controls={`pv-group-${g.key}`}
                      className="w-full flex items-center gap-2 p-3 text-left min-h-11 rounded-control hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
                          open ? "rotate-90" : ""
                        }`}
                        aria-hidden
                      />
                      <span className="text-sm font-semibold min-w-0 [overflow-wrap:anywhere]">
                        {g.label}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                        ({groupCountLabel(g, searching)})
                      </span>
                    </button>
                  </h3>
                  <div id={`pv-group-${g.key}`} hidden={!open} className="px-3 pb-3">
                    {g.items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {searching
                          ? `No ${g.label.toLowerCase()} candidates match this search.`
                          : CANDIDATE_GROUP_EMPTY[g.key]}
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {g.items.map((c) => (
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
                                <span className="text-sm font-medium min-w-0 [overflow-wrap:anywhere]">
                                  {c.display_name}
                                </span>
                                <span className="text-[11px] shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                                  {STATUS_LABEL[c.verification_status] ?? c.verification_status}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">
                                {c.district ?? "—"} · {c.category ?? "no category"}
                                {c.google_place_id ? " · Place ID set" : " · no Place ID"}
                              </p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>


        {/* WO-104A DEF-104A-01 — a published candidate is completed lifecycle
            history: read-only, no blockers, no publish/reject/save actions. */}
        {merged && isPublishedCandidate(merged) && (
          <section className="space-y-3">
            <div
              role="status"
              className="rounded-control border border-primary/40 bg-primary/5 p-3 space-y-1"
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Published to Community Places
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {merged.public_display_name || merged.display_name}
                {merged.published_at
                  ? ` · published ${new Date(merged.published_at).toLocaleDateString()}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                This candidate is now read-only. Edit the live place through Community Place
                operations.
              </p>
            </div>
            {merged.published_place_id && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/place/${merged.published_place_id}`)}
                >
                  View public place
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => navigate(`/owner/places/${merged.published_place_id}/photos`)}
                >
                  Manage photos
                </Button>
              </div>
            )}
          </section>
        )}

        {merged && !isPublishedCandidate(merged) && (
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

              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="pv-cat">Category</Label>
                  {/* WO-108: category is a fixed enum in the database. */}
                  <Select
                    value={merged.category ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  >
                    <SelectTrigger id="pv-cat" className="w-full">
                      <SelectValue placeholder="Choose category" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLACE_CATEGORIES.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="pv-district">District</Label>
                  <Input
                    id="pv-district"
                    value={merged.district ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="pv-class">Vegan / vegetarian classification</Label>
                {/* WO-108 DEF-108-01: controlled vocabulary — the owner can no
                    longer type a value the database CHECK will reject. */}
                <Select
                  value={merged.veggie_classification ?? ""}
                  onValueChange={(v) => setForm((f) => ({ ...f, veggie_classification: v }))}
                >
                  <SelectTrigger id="pv-class" className="w-full" aria-describedby="pv-class-help">
                    <SelectValue placeholder="Choose classification" />
                  </SelectTrigger>
                  <SelectContent>
                    {VEGGIE_CLASSIFICATIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="pv-class-help" className="text-[11px] text-muted-foreground">
                  Choose the classification supported by your verification evidence.
                </p>
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
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="pv-img">Cover image URL (licensed only)</Label>
                  <Input
                    id="pv-img"
                    value={merged.cover_image_url ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, cover_image_url: e.target.value || null }))}
                  />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="pv-rights">Image rights</Label>
                  {/* WO-108: fixed CHECK vocabulary — controlled options only. */}
                  <Select
                    value={merged.image_rights_status ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, image_rights_status: v }))}
                  >
                    <SelectTrigger id="pv-rights" className="w-full">
                      <SelectValue placeholder="Choose image rights" />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_RIGHTS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
