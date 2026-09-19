import type { MapLabMeetup, MapLabPlace } from "./mapLab";

/**
 * WO-153 — pure helpers for the PRIVATE owner map prototype.
 *
 * Nothing in this module touches member-facing surfaces. It holds the Mapbox
 * configuration, the privacy-conscious Veggie count rule, and the DEV-ONLY
 * fixture generators used to evaluate clustering and marker density while
 * production still has very few Meetups.
 */

/** Public, URL-restrictable browser token (pk.*). Never an sk.* token. */
export const MAPBOX_PUBLIC_TOKEN = (import.meta.env
  .VITE_LOVABLE_CONNECTOR_MAPBOX_PUBLIC_TOKEN ?? "") as string;

/** Low-noise light basemap so VeggieMeet markers stay the visual focus. */
export const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";

/**
 * Token-free raster basemap used ONLY when the Mapbox token is not authorised
 * for the current URL (403). The Mapbox GL engine, markers, clustering and
 * sheets stay identical; once the token allows the domain the map falls back to
 * `MAPBOX_STYLE` with no other change.
 */
export const UNAUTHORIZED_FALLBACK_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};


/** Native GeoJSON clustering configuration (WO-153 §25). */
export const CLUSTER_CONFIG = {
  cluster: true,
  clusterRadius: 50,
  clusterMaxZoom: 14,
} as const;

export const CITY_OVERVIEW_ZOOM = 11.5;

/**
 * WO-153 §12 small-count privacy rule.
 * count >= 3 → exact count. count 1–2 or 0 → no number at all.
 */
export function veggieCountLabel(count: number, cityName: string): string {
  if (count >= 3) return `${count} Veggies in ${cityName}`;
  return `Veggies in ${cityName}`;
}

/** Compact map-control copy. The same small-count rule applies here. */
export function nearbyVeggieCountLabel(count: number): string {
  if (count >= 3) return `${count} Veggies Nearby`;
  return "Veggies Nearby";
}

export function veggieEmptyCopy(cityName: string): string {
  return `More Veggies are joining ${cityName}.`;
}

export type FixtureDensity = "off" | "sparse" | "medium" | "large" | "downtown";

export const FIXTURE_DENSITY_LABELS: Record<FixtureDensity, string> = {
  off: "Off",
  sparse: "10",
  medium: "50",
  large: "200",
  downtown: "Dense downtown",
};

const FIXTURE_INTERESTS = [
  "coffee",
  "karaoke",
  "hiking",
  "yoga",
  "board_games",
  "live_music",
  "vegan_food",
  "cycling",
  "film",
  "picnics",
  null,
];

/** Deterministic PRNG so fixtures are stable across renders and snapshots. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Prototype-only Meetups. Never written to the database. */
export function fixtureMeetups(
  center: [number, number],
  density: FixtureDensity,
): MapLabMeetup[] {
  if (density === "off") return [];
  const count = density === "sparse" ? 10 : density === "medium" ? 50 : density === "large" ? 200 : 40;
  const spread = density === "downtown" ? 0.004 : 0.06;
  const rand = mulberry32(density.length * 7919 + count);
  const out: MapLabMeetup[] = [];
  for (let i = 0; i < count; i++) {
    const interest = FIXTURE_INTERESTS[Math.floor(rand() * FIXTURE_INTERESTS.length)];
    out.push({
      id: `fixture-meetup-${density}-${i}`,
      title: `Prototype Meetup ${i + 1}`,
      date: "2026-10-0" + ((i % 9) + 1),
      start_time: "18:00",
      primary_interest_id: interest,
      location_name: "Prototype location",
      location_source: "fixture",
      latitude: center[1] + (rand() - 0.5) * spread,
      longitude: center[0] + (rand() - 0.5) * spread,
      coordinate_origin: "meetup",
      is_fixture: true,
    });
  }
  return out;
}

/** Prototype-only Community Places, used only for cluster/perf evaluation. */
export function fixturePlaces(
  center: [number, number],
  density: FixtureDensity,
): MapLabPlace[] {
  if (density === "off") return [];
  const groups = ["restaurant", "cafe", "market", "park", "studio", "venue"];
  const count = density === "sparse" ? 10 : density === "medium" ? 30 : density === "large" ? 80 : 25;
  const spread = density === "downtown" ? 0.003 : 0.05;
  const rand = mulberry32(count * 104729);
  const out: MapLabPlace[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `fixture-place-${density}-${i}`,
      name: `Prototype Place ${i + 1}`,
      category: groups[i % groups.length],
      address: "Prototype address",
      neighborhood: null,
      veggie_classification: "fully_vegan",
      latitude: center[1] + (rand() - 0.5) * spread,
      longitude: center[0] + (rand() - 0.5) * spread,
      is_fixture: true,
    });
  }
  return out;
}

/** True when the browser can render a WebGL map at all (WO-153 §33). */
export function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
}

export function directionsHref(name: string, lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name} ${lat},${lng}`,
  )}`;
}
