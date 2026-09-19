import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-154 — source-level guards for the private member-facing Map.
 * These assert the privacy and scope invariants the work order requires.
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
  });

  it("reads member-visible data through RLS-enforced table queries", () => {
    // Reads go through the access-gated map RPC, which reuses the Community
    // discovery eligibility rule; no table grant or RLS policy is widened.
    expect(data).toContain('"get_member_map_data"');
    expect(data).not.toContain("get_owner_map_lab_data");
    expect(data).toContain("has_map_access");
  });

  it("is gated and does not change bottom navigation or Today", () => {
    expect(app).toContain('path="/map"');
    expect(app).toContain("RequireMapAccess");
    expect(nav).not.toContain('"/map"');
  });
});
