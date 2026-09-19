import { describe, expect, it } from "vitest";
import {
  CLUSTER_CONFIG,
  fixtureMeetups,
  fixturePlaces,
  nearbyVeggieCountLabel,
  veggieCountLabel,
  veggieEmptyCopy,
  directionsHref,
} from "./mapPrototype";

describe("WO-153 map prototype helpers", () => {
  it("applies the small-count privacy rule", () => {
    expect(veggieCountLabel(8, "Ho Chi Minh City")).toBe("8 Veggies in Ho Chi Minh City");
    expect(veggieCountLabel(3, "Ho Chi Minh City")).toBe("3 Veggies in Ho Chi Minh City");
    expect(veggieCountLabel(2, "Ho Chi Minh City")).toBe("Veggies in Ho Chi Minh City");
    expect(veggieCountLabel(1, "Ho Chi Minh City")).toBe("Veggies in Ho Chi Minh City");
    expect(veggieCountLabel(0, "Ho Chi Minh City")).toBe("Veggies in Ho Chi Minh City");
    expect(nearbyVeggieCountLabel(3)).toBe("3 Veggies Nearby");
    expect(nearbyVeggieCountLabel(2)).toBe("Veggies Nearby");
    expect(nearbyVeggieCountLabel(0)).toBe("Veggies Nearby");
  });

  it("never mentions distance, GPS or presence in Veggie copy", () => {
    const copy = [veggieCountLabel(9, "Da Nang"), veggieEmptyCopy("Da Nang")].join(" ").toLowerCase();
    for (const banned of ["km", "away", "online", "last seen", "gps", "nearby you", "distance"]) {
      expect(copy).not.toContain(banned);
    }
  });

  it("uses the approved clustering configuration", () => {
    expect(CLUSTER_CONFIG.cluster).toBe(true);
    expect(CLUSTER_CONFIG.clusterRadius).toBe(50);
    expect(CLUSTER_CONFIG.clusterMaxZoom).toBe(14);
  });

  it("generates deterministic, clearly-marked fixtures only when asked", () => {
    const center: [number, number] = [106.7009, 10.7769];
    expect(fixtureMeetups(center, "off")).toHaveLength(0);
    expect(fixturePlaces(center, "off")).toHaveLength(0);
    expect(fixtureMeetups(center, "sparse")).toHaveLength(10);
    expect(fixtureMeetups(center, "medium")).toHaveLength(50);
    expect(fixtureMeetups(center, "large")).toHaveLength(200);
    expect(fixtureMeetups(center, "downtown")).toHaveLength(40);

    const a = fixtureMeetups(center, "medium");
    const b = fixtureMeetups(center, "medium");
    expect(a[7]).toEqual(b[7]);
    for (const m of a) {
      expect(m.is_fixture).toBe(true);
      expect(m.id.startsWith("fixture-")).toBe(true);
      expect(m.title).toContain("Prototype");
    }
    for (const p of fixturePlaces(center, "large")) {
      expect(p.is_fixture).toBe(true);
      expect(p.id.startsWith("fixture-")).toBe(true);
    }
  });

  it("keeps dense downtown fixtures tightly grouped so clustering triggers", () => {
    const center: [number, number] = [106.7009, 10.7769];
    for (const m of fixtureMeetups(center, "downtown")) {
      expect(Math.abs(m.latitude - center[1])).toBeLessThan(0.0025);
      expect(Math.abs(m.longitude - center[0])).toBeLessThan(0.0025);
    }
  });

  it("sends directions to an external map instead of implementing routing", () => {
    expect(directionsHref("BÀ XÃ", 10.7, 106.7)).toContain("google.com/maps/search/");
  });
});
