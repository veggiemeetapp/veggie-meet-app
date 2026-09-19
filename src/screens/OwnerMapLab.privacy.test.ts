import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-152/WO-153 — the map prototype must stay private and must never render
 * member markers. These are source-level guards so a future edit cannot quietly
 * turn the prototype into a member-facing surface.
 */
const app = readFileSync("src/App.tsx", "utf8");
const screen = readFileSync("src/screens/OwnerMapLab.tsx", "utf8");
const robots = readFileSync("public/robots.txt", "utf8");

describe("WO-153 private map prototype", () => {
  it("is mounted only behind the owner gate", () => {
    expect(app).toContain('path="/owner/map-lab"');
    expect(app).toMatch(/path="\/owner\/map-lab" element=\{ownerGated\(<OwnerMapLab \/>\)\}/);
    // WO-154 added a separate member-facing `/map`, itself access-gated. The
    // prototype remains owner-only and distinct from it.
    expect(app).toMatch(/path="\/map" element=\{mapGated\(<MapScreen \/>\)\}/);
  });

  it("is not linked from bottom navigation or any member surface", () => {
    const nav = readFileSync("src/components/app/BottomNav.tsx", "utf8");
    expect(nav).not.toContain("map-lab");
    expect(nav).not.toContain("/map");
  });

  it("stays excluded from crawlers", () => {
    expect(robots).toMatch(/Disallow:\s*\/owner\//);
  });

  it("never requests GPS and never plots members on the map", () => {
    expect(screen).not.toContain("navigator.geolocation");
    expect(screen).not.toContain("GeolocateControl");
    // Veggies are read for the city-level pill/sheet only — never as features.
    expect(screen).toContain("fetchNearbyVeggiesByCity");
    expect(screen).not.toMatch(/veggie[^\n]*coordinates/i);
    expect(screen).not.toMatch(/veggies\.map\([^)]*Marker/);
  });

  it("never renders distance, coordinates or presence for Veggies", () => {
    const sheet = screen.slice(screen.indexOf("Veggies sheet"));
    for (const banned of ["latitude", "longitude", "distance", "last_seen", "km away"]) {
      expect(sheet).not.toContain(banned);
    }

  });

  it("uses a public Mapbox token only and never a secret token", () => {
    expect(screen).toContain("MAPBOX_PUBLIC_TOKEN");
    expect(screen).not.toContain("MAPBOX_API_KEY");
    expect(screen).not.toContain("sk.");
  });

  it("keeps the map library out of eagerly loaded chunks", () => {
    expect(app).toContain('lazy(() => import("./screens/OwnerMapLab"))');
    expect(screen).toContain('await import("mapbox-gl")');
  });

  it("keeps Community as the independent list alternative", () => {
    expect(screen).toContain("View as list");
    expect(screen).toContain('to="/community"');
  });

  it("uses a map-dominant viewport without prototype chrome by default", () => {
    expect(screen).toContain("h-dvh");
    expect(screen).not.toContain("Private prototype");
    expect(screen).not.toContain("CitySelector");
    expect(screen).not.toContain("Back to owner operations");
    expect(screen).not.toContain("Prototype info");
    expect(screen).toContain('searchParams.get("prototypeTools") === "1"');
    expect(screen).toContain("Prototype tools");
    expect(screen).toContain("Fixture data is temporary and never saved.");
    expect(screen).toContain("nearbyVeggieCountLabel(veggies.length)");
    expect(screen).not.toContain("Meetups and Community Places on the map for");
  });
});
