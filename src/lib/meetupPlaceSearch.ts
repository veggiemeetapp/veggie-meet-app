import { supabase } from "@/integrations/supabase/client";

/**
 * WO-123 — member-facing Google Places lookup for Meetup custom locations.
 *
 * Reuses the server-side `place-verification` proxy so the Google API key never
 * reaches the browser and only the allowed, field-masked verification fields
 * come back. Nothing here is trusted: the host still confirms the selection,
 * and the server re-validates every stored field.
 */
export interface MeetupPlaceResult {
  placeId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  businessStatus: string | null;
}

interface RawResult {
  place_id: string | null;
  display_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  business_status: string | null;
}

function toResult(r: RawResult): MeetupPlaceResult | null {
  if (!r.place_id || !r.display_name) return null;
  return {
    placeId: r.place_id,
    name: r.display_name,
    address: r.formatted_address ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    googleMapsUrl: r.google_maps_url ?? null,
    businessStatus: r.business_status ?? null,
  };
}

/** Search places by free text, biased to the given region (ISO-3166 alpha-2). */
export async function searchMeetupPlaces(
  query: string,
  region?: string | null,
): Promise<MeetupPlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.functions.invoke("place-verification", {
    body: { action: "search", query: q, region: region ?? "VN", scope: "meetup_location" },
  });
  if (error) throw new Error(await readFunctionError(error));
  if (data?.error) throw new Error(String(data.error));
  return ((data?.results ?? []) as RawResult[])
    .map(toResult)
    .filter((r): r is MeetupPlaceResult => r !== null)
    // Closed businesses are never useful as a Meetup location.
    .filter((r) => r.businessStatus !== "CLOSED_PERMANENTLY");
}

/** Persist the Google reference for a Meetup the signed-in member hosts. */
export async function setMeetupGoogleLocationMeta(
  meetupId: string,
  googlePlaceId: string | null,
  googleMapsUrl: string | null,
): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    n: string,
    a: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>).call(
    supabase,
    "set_meetup_google_location_meta",
    {
      _meetup_id: meetupId,
      _google_place_id: googlePlaceId,
      _google_maps_url: googleMapsUrl,
    },
  );
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
