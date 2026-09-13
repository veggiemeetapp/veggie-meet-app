import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-152 — the map prototype must stay private and must never render member
 * markers. These are source-level guards so a future edit cannot quietly turn
 * the proof of concept into a member-facing surface.
 */
const app = readFileSync("src/App.tsx", "utf8");
const screen = readFileSync("src/screens/OwnerMapLab.tsx", "utf8");
const robots = readFileSync("public/robots.txt", "utf8");

describe("WO-152 private map prototype", () => {
  it("is mounted only behind the owner gate", () => {
    expect(app).toContain('path="/owner/map-lab"');
    expect(app).toMatch(/path="\/owner\/map-lab" element=\{ownerGated\(<OwnerMapLab \/>\)\}/);
    expect(app).not.toMatch(/path="\/map"/);
  });

  it("is not linked from bottom navigation or any member surface", () => {
    const nav = readFileSync("src/components/app/BottomNav.tsx", "utf8");
    expect(nav).not.toContain("map-lab");
    expect(nav).not.toContain("/map");
  });

  it("stays excluded from crawlers", () => {
    expect(robots).toMatch(/Disallow:\s*\/owner\//);
  });

  it("never queries or plots member profiles", () => {
    expect(screen).not.toContain("fetchNearbyVeggiesByCity");
    expect(screen).not.toContain("discovery_eligible");
    expect(screen).not.toContain("navigator.geolocation");
    // Only the owner-gated read-only RPC wrapper is used for data.
    expect(screen).toContain("fetchMapLabData");
  });

  it("keeps the map library out of eagerly loaded chunks", () => {
    expect(app).toContain('lazy(() => import("./screens/OwnerMapLab"))');
    expect(screen).toContain('await import("maplibre-gl")');
  });
});
