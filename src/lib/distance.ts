/**
 * Client-side distance utility. Uses coordinates only when both are valid.
 * Returns human-readable strings following the WO-035 spec:
 *   < 1 km   → nearest 100 m ("600 m away")
 *   < 10 km  → one decimal   ("3.2 km away")
 *   ≥ 10 km  → whole km      ("18 km away")
 * Never fabricates a number when coordinates are missing.
 */

export interface Coords {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}

function hasValidCoords(c: Coords | null | undefined): c is { latitude: number; longitude: number } {
  if (!c) return false;
  const { latitude, longitude } = c;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in metres. */
export function distanceMeters(a: Coords, b: Coords): number | null {
  if (!hasValidCoords(a) || !hasValidCoords(b)) return null;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function formatDistanceMeters(m: number | null): string | null {
  if (m == null || !Number.isFinite(m) || m < 0) return null;
  if (m < 1000) {
    const rounded = Math.max(100, Math.round(m / 100) * 100);
    return `${rounded} m away`;
  }
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

export function formatDistanceBetween(a: Coords | null, b: Coords | null): string | null {
  if (!a || !b) return null;
  return formatDistanceMeters(distanceMeters(a, b));
}

/** Fallback label chain: neighborhood → city → null. Never fabricates distance. */
export function locationFallbackLabel(opts: {
  neighborhood?: string | null;
  cityName?: string | null;
}): string | null {
  const n = opts.neighborhood?.trim();
  if (n) return n;
  const c = opts.cityName?.trim();
  if (c) return c;
  return null;
}
