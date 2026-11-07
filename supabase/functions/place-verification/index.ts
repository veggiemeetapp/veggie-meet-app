// WO-043B — Owner-only Google Places verification proxy.
//
// Server-side only. The Google Places API key lives in the GOOGLE_PLACES_API_KEY
// Lovable secret and is never returned to the browser.
//
// Only the ALLOWED verification fields are requested via field mask. Reviews,
// review text, ratings, editorial summaries, photos, author attribution and
// opening hours are never requested and never stored.
//
// Actions: "search" / "details" are read-only lookups. "discover" (owner-only)
// bulk-imports one text query's results as `needs_review` candidates; see the
// discover() section below.
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

// ---------------------------------------------------------------------------
// Bulk discovery (owner-only). One text query per call; results are written as
// `needs_review` candidates through the CALLER's RLS-scoped client, so the
// owner allowlist policy on place_candidates is enforced by the database.
// ---------------------------------------------------------------------------

const DISCOVER_MASK = `${SEARCH_MASK},nextPageToken`;
const DISCOVER_MAX_PAGES = 3; // 3 × 20 = up to 60 results per query
const DISCOVER_CITY_RADIUS_M = 40_000;
const DISCOVER_INSERT_CAP = 150;

type ActiveCity = {
  id: string;
  name: string;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
};

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Map Google's primary type onto the place_category enum (nullable). */
function categoryFromType(t: string | null | undefined): string | null {
  if (!t) return null;
  if (/^(cafe|coffee_shop|tea_house|bakery|dessert_shop|dessert_restaurant|juice_shop|ice_cream_shop)$/.test(t)) return 'cafe';
  if (/restaurant$|^(meal_takeaway|meal_delivery|food_court|diner|food)$/.test(t)) return 'restaurant';
  if (/^(grocery_store|supermarket|market|asian_grocery_store|food_store|convenience_store)$/.test(t)) return 'market';
  return null;
}

/** Vegan classification is NEVER pre-filled: Google's type is only a hint. */
function discoveryNotes(query: string, primaryType: string | null): string {
  const hint =
    primaryType === 'vegan_restaurant'
      ? 'Google lists this as a vegan restaurant.'
      : primaryType === 'vegetarian_restaurant'
        ? 'Google lists this as a vegetarian restaurant.'
        : primaryType
          ? `Google type: ${primaryType}.`
          : 'Google type unknown.';
  return `Discovered via Google Places search "${query}". ${hint} Confirm the classification with the official website, menu or social account before publishing.`;
}

async function discover(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  body: Record<string, unknown> | null,
  apiKey: string,
): Promise<Response> {
  const cityId = typeof body?.city_id === 'string' ? body.city_id.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(cityId)) return json({ error: 'city_id must be a uuid' }, 400);

  const query = (typeof body?.query === 'string' ? body.query : '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (query.length < 2 || query.length > 100) return json({ error: 'query must be 2-100 characters' }, 400);

  // City comes from the same RPC the app uses; inactive cities are not offered.
  const { data: cities, error: cityErr } = await supabase.rpc('get_active_cities');
  if (cityErr) return json({ error: cityErr.message }, 500);
  const city = ((cities ?? []) as ActiveCity[]).find((c) => c.id === cityId);
  if (!city) return json({ error: 'Unknown or inactive city' }, 404);
  const hasCenter =
    typeof city.latitude === 'number' && Number.isFinite(city.latitude) &&
    typeof city.longitude === 'number' && Number.isFinite(city.longitude);

  // Known Place IDs: candidates (owner RLS) + live places.
  const known = new Set<string>();
  const { data: cand, error: candErr } = await supabase
    .from('place_candidates')
    .select('google_place_id')
    .not('google_place_id', 'is', null);
  if (candErr) return json({ error: candErr.message }, 500);
  for (const r of cand ?? []) if (r.google_place_id) known.add(r.google_place_id);
  const { data: live, error: liveErr } = await supabase
    .from('community_places')
    .select('google_place_id')
    .not('google_place_id', 'is', null);
  if (liveErr) return json({ error: liveErr.message }, 500);
  for (const r of live ?? []) if (r.google_place_id) known.add(r.google_place_id);

  // Google Text Search (New), paginated.
  const baseBody: Record<string, unknown> = {
    textQuery: `${query} ${city.name}`,
    regionCode: city.country_code,
    pageSize: 20,
  };
  if (hasCenter) {
    baseBody.locationBias = {
      circle: { center: { latitude: city.latitude, longitude: city.longitude }, radius: 30_000 },
    };
  }

  const places: GooglePlace[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < DISCOVER_MAX_PAGES; page++) {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DISCOVER_MASK,
      },
      body: JSON.stringify(pageToken ? { ...baseBody, pageToken } : baseBody),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`Places discover failed [${res.status}]: ${detail}`);
      return json({ error: 'Google Places request failed', status: res.status, details: detail }, res.status);
    }
    const data = await res.json();
    places.push(...((data.places ?? []) as GooglePlace[]));
    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
    if (!pageToken) break;
  }

  let skippedExisting = 0;
  let skippedClosed = 0;
  let skippedFar = 0;
  const seenThisRun = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const p of places) {
    const c = toCandidate(p);
    if (!c.place_id || !c.display_name || !c.formatted_address) { skippedFar++; continue; }
    if (seenThisRun.has(c.place_id)) continue;
    seenThisRun.add(c.place_id);
    if (known.has(c.place_id)) { skippedExisting++; continue; }
    if (c.business_status !== 'OPERATIONAL') { skippedClosed++; continue; }
    if (
      typeof c.latitude !== 'number' || typeof c.longitude !== 'number' ||
      !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)
    ) { skippedFar++; continue; }
    if (hasCenter &&
        haversineMeters(city.latitude!, city.longitude!, c.latitude, c.longitude) > DISCOVER_CITY_RADIUS_M) {
      skippedFar++; continue;
    }
    if (rows.length >= DISCOVER_INSERT_CAP) break;
    rows.push({
      google_place_id: c.place_id,
      google_display_name: c.display_name,
      google_formatted_address: c.formatted_address,
      google_primary_type: c.primary_type,
      google_maps_url: c.google_maps_url,
      google_website_url: c.website_url,
      business_status: c.business_status,
      latitude: c.latitude,
      longitude: c.longitude,
      display_name: c.display_name,
      category: categoryFromType(c.primary_type),
      city_id: city.id,
      source: 'google_discovered',
      verification_status: 'needs_review',
      verification_notes: discoveryNotes(query, c.primary_type),
    });
  }

  let inserted = 0;
  if (rows.length > 0) {
    const { data: ins, error: insErr } = await supabase
      .from('place_candidates')
      .insert(rows)
      .select('id');
    if (insErr) {
      console.error('discover insert failed', insErr);
      return json({ error: insErr.message }, 500);
    }
    inserted = (ins ?? []).length;
  }

  return json({
    query,
    fetched: places.length,
    inserted,
    skipped_existing: skippedExisting,
    skipped_closed: skippedClosed,
    skipped_far: skippedFar,
  });
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
    if (action !== 'search' && action !== 'details' && action !== 'discover') {
      return json({ error: 'action must be "search", "details" or "discover"' }, 400);
    }

    // ---- 3. Authorization ----
    // WO-123: any signed-in member may look up a place for a Meetup custom
    // location (`scope: "meetup_location"`). Everything else — the Community
    // Place verification workspace — stays owner-only. Both paths return the
    // same narrow, field-masked projection; nothing is written here.
    const memberScope = body?.scope === 'meetup_location' && action !== 'discover';
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

    if (action === 'discover') {
      return await discover(supabase, body, apiKey);
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
