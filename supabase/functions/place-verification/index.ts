// WO-043B — Owner-only Google Places verification proxy.
//
// Server-side only. The Google Places API key lives in the GOOGLE_PLACES_API_KEY
// Lovable secret and is never returned to the browser.
//
// Only the ALLOWED verification fields are requested via field mask. Reviews,
// review text, ratings, editorial summaries, photos, author attribution and
// opening hours are never requested and never stored.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// WO-123A — best-effort per-caller rate limit to cap Google API cost abuse.
// Deliberately in-memory (per isolate): search/details must never write to the
// database. Owner verification work is exempt from the tighter member budget.
const RATE_WINDOW_MS = 60_000;
const MEMBER_MAX_PER_WINDOW = 20;
const OWNER_MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function rateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

// Allowed verification fields ONLY.
const SEARCH_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryType',
  'places.websiteUri',
].join(',');

// Meetup typeahead does not render verification-only website/type metadata.
// Keeping its payload narrow reduces Google processing and transfer time.
const MEETUP_SEARCH_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

const DETAILS_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'googleMapsUri',
  'businessStatus',
  'primaryType',
  'websiteUri',
].join(',');

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  businessStatus?: string;
  primaryType?: string;
  websiteUri?: string;
};

/** Project only the permitted fields onto the wire shape we return. */
function toCandidate(p: GooglePlace) {
  return {
    place_id: p.id ?? null,
    display_name: p.displayName?.text ?? null,
    formatted_address: p.formattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    google_maps_url: p.googleMapsUri ?? null,
    business_status: p.businessStatus ?? null,
    primary_type: p.primaryType ?? null,
    website_url: p.websiteUri ?? null,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ---- 1. Authentication ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'permission denied' }, 403);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) return json({ error: 'permission denied' }, 403);

    // ---- 2. Input validation ----
    const body = await req.json().catch(() => null);
    const action = typeof body?.action === 'string' ? body.action : '';
    if (action !== 'search' && action !== 'details') {
      return json({ error: 'action must be "search" or "details"' }, 400);
    }

    // ---- 3. Authorization ----
    // WO-123: any signed-in member may look up a place for a Meetup custom
    // location (`scope: "meetup_location"`). Everything else — the Community
    // Place verification workspace — stays owner-only. Both paths return the
    // same narrow, field-masked projection; nothing is written here.
    const memberScope = body?.scope === 'meetup_location';
    if (!memberScope) {
      const { data: isOwner, error: ownerError } = await supabase.rpc('is_owner');
      if (ownerError || isOwner !== true) return json({ error: 'permission denied' }, 403);
    }

    // ---- 3b. Rate limit (WO-123A) ----
    const callerId = String(claims.claims.sub ?? 'unknown');
    if (rateLimited(callerId, memberScope ? MEMBER_MAX_PER_WINDOW : OWNER_MAX_PER_WINDOW)) {
      return json({ error: 'Too many place searches. Please wait a moment and try again.' }, 429);
    }

    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) return json({ error: 'GOOGLE_PLACES_API_KEY is not configured' }, 503);

    // ---- 4. Google Places API (New) ----
    if (action === 'search') {
      // Normalize: collapse whitespace and control characters before spending a
      // paid Google call, so "  cafe   x  " and "cafe x" are one query shape.
      const query = (typeof body?.query === 'string' ? body.query : '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (query.length < 2 || query.length > 200) {
        return json({ error: 'query must be 2-200 characters' }, 400);
      }
      const region = (typeof body?.region === 'string' ? body.region : 'VN')
        .toUpperCase()
        .slice(0, 2);

      const latitude = typeof body?.latitude === 'number' ? body.latitude : null;
      const longitude = typeof body?.longitude === 'number' ? body.longitude : null;
      const hasLocationBias =
        latitude !== null && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
        longitude !== null && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
      const requestBody: Record<string, unknown> = {
        textQuery: query,
        regionCode: region,
        // `maxResultCount` is deprecated by Places Text Search (New).
        pageSize: memberScope ? 6 : 8,
      };
      if (hasLocationBias) {
        requestBody.locationBias = {
          circle: {
            center: { latitude, longitude },
            radius: 50_000,
          },
        };
      }

      const res = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': memberScope ? MEETUP_SEARCH_MASK : SEARCH_MASK,
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const detail = await res.text();
        console.error(`Places searchText failed [${res.status}]: ${detail}`);
        return json({ error: 'Google Places request failed', status: res.status, details: detail }, res.status);
      }
      const data = await res.json();
      return json({ results: ((data.places ?? []) as GooglePlace[]).map(toCandidate) });
    }

    const placeId = typeof body?.place_id === 'string' ? body.place_id.trim() : '';
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(placeId)) return json({ error: 'invalid place_id' }, 400);

    const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAILS_MASK },
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Places details failed [${res.status}]: ${detail}`);
      return json({ error: 'Google Places request failed', status: res.status, details: detail }, res.status);
    }
    return json({ result: toCandidate(await res.json() as GooglePlace) });
  } catch (e) {
    console.error('place-verification error', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
