import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Search as SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  fetchGooglePlaceDetails,
  fetchPlaceCandidates,
  isOwner,
  publishCandidate,
  rejectCandidate,
  saveCandidateDraft,
  searchGooglePlaces,
  type GoogleCandidate,
  type PlaceCandidate,
} from "@/lib/placeVerification";
import { SuggestionQueue } from "@/components/owner/SuggestionQueue";
import { PlaceMaintenance } from "@/components/owner/PlaceMaintenance";
import { ReportQueue } from "@/components/owner/ReportQueue";
import { ReverificationQueue } from "@/components/owner/ReverificationQueue";


const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  verified: "Verified",
  published: "Published",
  rejected: "Rejected",
};

/** Publish gate mirrored from the server-side publish_place_candidate() checks,
 *  so the owner sees why a candidate is not publishable before trying. */
function publishBlockers(c: PlaceCandidate): string[] {
  const out: string[] = [];
  if (c.latitude == null || c.longitude == null) out.push("Verified latitude and longitude required");
  if (!c.google_formatted_address) out.push("Verified address required");
  if (!c.category) out.push("Category required");
  if (!c.description || c.description.trim().length < 20)
    out.push("Original VeggieMeet description required (20+ characters)");
  if (c.image_rights_status !== "licensed" && c.image_rights_status !== "owner_supplied" &&
      c.image_rights_status !== "restaurant_supplied" && c.image_rights_status !== "none")
    out.push('Image rights must be "none" (no image), "owner_supplied", "restaurant_supplied" or "licensed"');
  if (c.cover_image_url && c.image_rights_status === "none")
    out.push("A cover image requires cleared image rights");

  if (c.business_status && c.business_status !== "OPERATIONAL")
    out.push(`Google business status is ${c.business_status}`);
  if (c.verification_status === "published") out.push("Already published");
  if (c.verification_status === "rejected") out.push("Candidate is rejected");
  return out;
}

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

  const publishM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No candidate selected");
      if (Object.keys(form).length > 0) await saveCandidateDraft(selected.id, form);
      return publishCandidate(selected.id);
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

  function importGoogle(g: GoogleCandidate) {
    setForm((f) => ({
      ...f,
      google_place_id: g.place_id,
      google_display_name: g.display_name,
      google_formatted_address: g.formatted_address,
      google_primary_type: g.primary_type,
      google_maps_url: g.google_maps_url,
      google_website_url: g.website_url,
      business_status: g.business_status,
      latitude: g.latitude,
      longitude: g.longitude,
    }));
    toast.success("Imported verified fields. Review, then save.");
  }

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
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
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
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Verify against Google Places</h2>
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name and city, e.g. Hum Vegetarian Ho Chi Minh City"
                  onKeyDown={(e) => e.key === "Enter" && searchM.mutate()}
                />
                <Button onClick={() => searchM.mutate()} disabled={searchM.isPending || query.trim().length < 2}>
                  {searchM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only Place ID, name, address, coordinates, Maps link, status, type and website are retrieved.
                Reviews, ratings and photos are never requested or stored.
              </p>
              {googleResults?.map((g) => (
                <div key={g.place_id} className="rounded-lg border p-3 space-y-1">
                  <p className="text-sm font-medium">{g.display_name}</p>
                  <p className="text-xs text-muted-foreground">{g.formatted_address}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.business_status ?? "status unknown"} · {g.primary_type ?? "type unknown"} ·{" "}
                    {g.latitude?.toFixed(5)}, {g.longitude?.toFixed(5)}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" onClick={() => importGoogle(g)}>Import fields</Button>
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
              ))}
            </section>

            {/* ---- Curation form ---- */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Curated VeggieMeet copy</h2>
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

              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-medium">Verified Google fields</p>
                <p>Place ID: {merged.google_place_id ?? "—"}</p>
                <p>Address: {merged.google_formatted_address ?? "—"}</p>
                <p>
                  Coordinates:{" "}
                  {merged.latitude != null && merged.longitude != null
                    ? `${merged.latitude}, ${merged.longitude}`
                    : "—"}
                </p>
                <p>Business status: {merged.business_status ?? "—"}</p>
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
                <p className="text-muted-foreground pt-1">
                  Place data © Google. Ratings, reviews and photos are not stored.
                </p>
              </div>

              {publishBlockers(merged).length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
                  <p className="font-medium text-destructive">Not publishable yet</p>
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {publishBlockers(merged).map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
                  Save draft
                </Button>
                <Button
                  onClick={() => publishM.mutate()}
                  disabled={publishM.isPending || publishBlockers(merged).length > 0}
                >
                  {publishM.isPending ? "Publishing…" : "Verify & publish"}
                </Button>
                <Button variant="ghost" onClick={() => rejectM.mutate()} disabled={rejectM.isPending}>
                  Reject
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
