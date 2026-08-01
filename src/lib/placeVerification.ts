import { supabase } from "@/integrations/supabase/client";

/** A Google Places result, limited to the WO-043B allowed verification fields. */
export interface GoogleCandidate {
  place_id: string | null;
  display_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  business_status: string | null;
  primary_type: string | null;
  website_url: string | null;
}

export type CandidateStatus = "draft" | "verified" | "rejected" | "needs_review" | "published";

export interface PlaceCandidate {
  id: string;
  google_place_id: string | null;
  google_display_name: string | null;
  google_formatted_address: string | null;
  google_primary_type: string | null;
  google_maps_url: string | null;
  google_website_url: string | null;
  business_status: string | null;
  latitude: number | null;
  longitude: number | null;
  display_name: string;
  category: string | null;
  veggie_classification: string | null;
  veggie_reason: string | null;
  description: string | null;
  district: string | null;
  group_suitability: string | null;
  cover_image_url: string | null;
  image_source: string | null;
  image_rights_status: string;
  verification_notes: string | null;
  verification_status: CandidateStatus;
  review_order: number | null;
  source: string;
  published_place_id: string | null;
  published_at: string | null;
}

/** Is the signed-in user on the owner allowlist? Never trust this alone — the
 *  server re-checks on every read, write, publish and Google call. */
export async function isOwner(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_owner");
  if (error) return false;
  return data === true;
}

export async function fetchPlaceCandidates(): Promise<PlaceCandidate[]> {
  const { data, error } = await supabase
    .from("place_candidates")
    .select("*")
    .order("review_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlaceCandidate[];
}

/** Owner-only Google Places text search, proxied server-side. */
export async function searchGooglePlaces(query: string): Promise<GoogleCandidate[]> {
  const { data, error } = await supabase.functions.invoke("place-verification", {
    body: { action: "search", query },
  });
  if (error) throw new Error(await readFunctionError(error));
  if (data?.error) throw new Error(String(data.error));
  return (data?.results ?? []) as GoogleCandidate[];
}

export async function fetchGooglePlaceDetails(placeId: string): Promise<GoogleCandidate> {
  const { data, error } = await supabase.functions.invoke("place-verification", {
    body: { action: "details", place_id: placeId },
  });
  if (error) throw new Error(await readFunctionError(error));
  if (data?.error) throw new Error(String(data.error));
  return data.result as GoogleCandidate;
}

export async function saveCandidateDraft(
  id: string,
  patch: Partial<PlaceCandidate>,
): Promise<void> {
  const { error } = await supabase
    .from("place_candidates")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function publishCandidate(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("publish_place_candidate", {
    _candidate_id: id,
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

export async function rejectCandidate(id: string, notes?: string): Promise<void> {
  const { error } = await supabase.rpc("reject_place_candidate", {
    _candidate_id: id,
    _notes: notes ?? null,
  });
  if (error) throw new Error(error.message);
}

async function readFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: { text?: () => Promise<string> } })?.context;
  if (ctx?.text) {
    try {
      const raw = await ctx.text();
      try {
        const parsed = JSON.parse(raw);
        return parsed.details ?? parsed.error ?? raw;
      } catch {
        return raw;
      }
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error.message : String(error);
}
