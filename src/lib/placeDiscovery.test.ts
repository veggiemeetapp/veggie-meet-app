import { describe, expect, it } from "vitest";
import {
  discoveryQueriesFor,
  discoverySummaryMessage,
  summarizeDiscovery,
  type DiscoveryBatchResult,
} from "./placeDiscovery";

const batch = (over: Partial<DiscoveryBatchResult>): DiscoveryBatchResult => ({
  query: "q",
  fetched: 0,
  inserted: 0,
  skipped_existing: 0,
  skipped_closed: 0,
  skipped_far: 0,
  ...over,
});

describe("discoveryQueriesFor", () => {
  it("uses local-language terms for Vietnam and is case-insensitive", () => {
    expect(discoveryQueriesFor("vn")).toContain("quán chay");
    expect(discoveryQueriesFor("VN")).toContain("vegan restaurant");
  });

  it("falls back to English queries for unknown or missing countries", () => {
    expect(discoveryQueriesFor("DE")).toEqual(discoveryQueriesFor(null));
    expect(discoveryQueriesFor(undefined)[0]).toBe("vegan restaurant");
  });

  it("returns a fresh array each call", () => {
    const a = discoveryQueriesFor("SG");
    a.push("x");
    expect(discoveryQueriesFor("SG")).not.toContain("x");
  });
});

describe("summarizeDiscovery", () => {
  it("totals every counter across batches", () => {
    const s = summarizeDiscovery([
      batch({ fetched: 20, inserted: 5, skipped_existing: 10, skipped_closed: 2, skipped_far: 3 }),
      batch({ fetched: 7, inserted: 1, skipped_existing: 6 }),
    ]);
    expect(s).toEqual({
      queries: 2,
      fetched: 27,
      inserted: 6,
      skipped_existing: 16,
      skipped_closed: 2,
      skipped_far: 3,
    });
  });

  it("treats non-numeric server values as zero", () => {
    const s = summarizeDiscovery([batch({ inserted: Number.NaN })]);
    expect(s.inserted).toBe(0);
  });
});

describe("discoverySummaryMessage", () => {
  it("explains an empty Google result", () => {
    expect(discoverySummaryMessage(summarizeDiscovery([batch({})]))).toMatch(/no places/i);
  });

  it("explains why nothing new was added", () => {
    const msg = discoverySummaryMessage(
      summarizeDiscovery([batch({ fetched: 4, skipped_existing: 3, skipped_closed: 1 })]),
    );
    expect(msg).toMatch(/No new places/);
    expect(msg).toContain("3 already known");
  });

  it("reports singular and plural inserts", () => {
    expect(discoverySummaryMessage(summarizeDiscovery([batch({ fetched: 1, inserted: 1 })]))).toContain("1 new candidate ");
    expect(discoverySummaryMessage(summarizeDiscovery([batch({ fetched: 2, inserted: 2 })]))).toContain("2 new candidates");
  });
});
