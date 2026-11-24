import { describe, expect, it } from "vitest";
import { COUNTRIES, WORLD_COUNTRY_COUNT, countryByCode, flagEmoji, searchCountries, worldPercent } from "./countries";

describe("countries", () => {
  it("lists exactly 195 unique alpha-2 codes", () => {
    expect(COUNTRIES.length).toBe(WORLD_COUNTRY_COUNT);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(195);
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  it("knows the countries VeggieMeet members care about, including small ones", () => {
    for (const code of ["VN", "SG", "TH", "JP", "MY", "ID", "US", "GB", "VA", "PS"]) {
      expect(countryByCode(code)?.name).toBeTruthy();
    }
    expect(countryByCode("SG")?.dot).toBe(true);
    expect(countryByCode("VN")?.dot).toBeUndefined();
  });

  it("builds flag emoji from the code", () => {
    expect(flagEmoji("VN")).toBe("🇻🇳");
    expect(flagEmoji("xx")).toBe("🇽🇽");
    expect(flagEmoji("V1")).toBe("🏳️");
  });

  it("formats the share of the world like NomadTable", () => {
    expect(worldPercent(0)).toBe("0");
    expect(worldPercent(3)).toBe("1.5");
    expect(worldPercent(1)).toBe("0.5");
    expect(worldPercent(40)).toBe("21");
  });

  it("searches by name prefix first, accent-insensitively, and by code", () => {
    expect(searchCountries("viet")[0]?.code).toBe("VN");
    expect(searchCountries("cote")[0]?.code).toBe("CI");
    expect(searchCountries("sg")[0]?.code).toBe("SG");
    expect(searchCountries("")).toEqual([]);
    expect(searchCountries("land").length).toBeGreaterThan(3);
  });
});
