import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Source-level guards for the authenticated member-facing Explore map.
 * These assert its privacy and production-data invariants.
 */
const screen = readFileSync("src/screens/MapScreen.tsx", "utf8");
const data = readFileSync("src/lib/memberMap.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const nav = readFileSync("src/components/app/BottomNav.tsx", "utf8");

describe("member Map privacy and scope", () => {
  it("never plots Veggies and never reads member location", () => {
    expect(screen).not.toMatch(/veggie.*coordinates/i);
    expect(screen).not.toContain("new mapboxgl.GeolocateControl");
    expect(screen).not.toContain("navigator.geolocation");
    expect(screen).not.toContain("formatDistance");
    expect(screen).not.toMatch(/last_seen/i);
    // Veggies exist only in the city-level pill and sheet.
    expect(screen).toContain("nearbyVeggieCountLabel(veggies.length)");
    expect(screen).toContain("veggieCountLabel(veggies.length, cityName)");
  });

  it("uses production data only — no fixtures or prototype tools", () => {
    expect(screen).not.toContain("is_fixture");
    expect(screen).not.toContain("fixtureMeetups");
    expect(screen).not.toContain("fixturePlaces");
    expect(screen).not.toContain("FIXTURE_DENSITY_LABELS");
    expect(screen).not.toContain("prototypeTools");
    expect(screen).not.toContain("Prototype data");
    expect(data).not.toContain("fixtureMeetups");
    expect(data).not.toContain("is_fixture");
  });

  it("keeps the approved WO-153C visuals and controls", () => {
    expect(screen).toContain("clusterMarkerElement");
    expect(screen).toContain("pointMarkerElement");
    expect(screen).toContain("CLUSTER_CONFIG");
    expect(screen).toContain("View as list");
    expect(screen).toContain('aria-label="Map layers"');
    expect(screen).toContain("Community Places");
    expect(screen).toContain("cover_image_url");
    expect(screen).toContain('map.on("style.load"');
    expect(screen).not.toContain('map.on("load"');
    expect(screen).toContain('import("maplibre-gl")');
    expect(screen).toContain("mapEngine.setWorkerUrl(maplibreWorkerUrl)");
    expect(screen).toContain("normalizeFallbackGlyphUrl");
    expect(screen).toContain("new ResizeObserver");
  });

  it("reads member-visible data through the server-side map RPC", () => {
    // The RPC reuses the Community discovery eligibility rule; no direct table
    // grant or owner-only prototype data path is introduced.
    expect(data).toContain('"get_member_map_data"');
    expect(data).not.toContain("get_owner_map_lab_data");
    expect(data).not.toContain("fetchMapAccess");
  });

  it("is an authenticated primary Explore tab", () => {
    expect(app).toContain('path="/" element={gated(<MapScreen />)}');
    expect(app).toContain('path="/map" element={<Navigate to="/" replace />}');
    expect(app).not.toContain("RequireMapAccess");
    expect(nav).toContain('{ label: "Explore", to: "/"');
    expect(nav).not.toContain('{ label: "Today"');
  });
});
