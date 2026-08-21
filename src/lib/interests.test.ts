import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MEETUP_MAX_ADDITIONAL_INTERESTS,
  ONBOARDING_MAX_INTERESTS,
  ONBOARDING_MIN_INTERESTS,
  PROFILE_MAX_INTERESTS,
  PROFILE_MIN_INTERESTS,
  PROFILE_RECOMMENDED_INTERESTS,
  filterInterests,
  groupInterests,
  meetupInterestScore,
} from "@/lib/interests";
import type { InterestOption } from "@/lib/onboarding";

/**
 * WO-124A — contract tests for the shared interest taxonomy.
 *
 * The taxonomy itself lives in the database; the approved canonical list is
 * asserted against the migration that defines it so drift is caught in CI.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

function taxonomySql(): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const hit = [...files]
    .reverse()
    .find((f) =>
      fs
        .readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")
        .includes("INSERT INTO public.interest_catalogue (id, label, group_key"),
    );
  if (!hit) throw new Error("canonical taxonomy migration not found");
  return fs.readFileSync(path.join(MIGRATIONS_DIR, hit), "utf8");
}

interface Row {
  id: string;
  label: string;
  group: string;
}

function canonicalRows(): Row[] {
  const sql = taxonomySql();
  const re = /\('([a-z_]+)','([^']+)','([a-z_]+)','([^']+)',(\d+),(\d+)\)/g;
  const rows: Row[] = [];
  for (const m of sql.matchAll(re)) {
    rows.push({ id: m[1], label: m[2], group: m[4] });
  }
  return rows;
}

describe("canonical taxonomy", () => {
  const rows = canonicalRows();

  it("defines exactly 35 canonical interests with unique ids and labels", () => {
    expect(rows).toHaveLength(35);
    expect(new Set(rows.map((r) => r.id)).size).toBe(35);
    expect(new Set(rows.map((r) => r.label)).size).toBe(35);
  });

  it("matches the approved group counts", () => {
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.group] = (acc[r.group] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      "Food & Social": 7,
      "Culture & Entertainment": 9,
      "Outdoors & Adventure": 7,
      "Sports & Wellness": 6,
      "Travel & Learning": 3,
      "Community & Purpose": 3,
    });
  });

  it("excludes the interests that were explicitly not approved", () => {
    const labels = rows.map((r) => r.label);
    for (const banned of [
      "Urban Exploring",
      "Water Activities",
      "Baking",
      "Brunch",
      "Alcohol-Free Socials",
    ]) {
      expect(labels).not.toContain(banned);
    }
  });

  it("contains no sensitive identity characteristics", () => {
    const sensitive =
      /(gender|sexual|religio|ethnic|race|racial|disab|health|political party|pregnan|hiv)/i;
    for (const r of rows) expect(r.label).not.toMatch(sensitive);
  });

  it("retires Baking by mapping legacy values to Cooking rather than deleting them", () => {
    const sql = taxonomySql();
    expect(sql).toMatch(/interest_legacy_map[\s\S]*'baking','cooking'/);
    expect(sql).not.toMatch(/DELETE FROM public\.interest_catalogue/i);
    expect(sql).not.toMatch(/DELETE FROM public\.interest_legacy_map/i);
  });

  it("keeps legacy Books mapped to Reading", () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const all = files
      .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    expect(all.toLowerCase()).toMatch(/'books'\s*,\s*'reading'/);
  });

  it("keeps stable ids independent of display text", () => {
    for (const r of rows) expect(r.id).toMatch(/^[a-z][a-z_]*$/);
  });
});

describe("selection bounds", () => {
  it("onboarding requires 3 and caps at 8", () => {
    expect(ONBOARDING_MIN_INTERESTS).toBe(3);
    expect(ONBOARDING_MAX_INTERESTS).toBe(8);
  });

  it("profile editing allows 0 through 20 and recommends 3", () => {
    expect(PROFILE_MIN_INTERESTS).toBe(0);
    expect(PROFILE_MAX_INTERESTS).toBe(20);
    expect(PROFILE_RECOMMENDED_INTERESTS).toBe(3);
  });

  it("meetups allow at most two additional interests (three tags total)", () => {
    expect(MEETUP_MAX_ADDITIONAL_INTERESTS).toBe(2);
  });
});

const OPTS: InterestOption[] = [
  { id: "coffee", label: "Coffee", category: null, active: true, sort_order: 1, group_key: "food_social", group_label: "Food & Social", group_sort: 1 },
  { id: "yoga", label: "Yoga", category: null, active: true, sort_order: 1, group_key: "sports_wellness", group_label: "Sports & Wellness", group_sort: 4 },
  { id: "hiking", label: "Hiking", category: null, active: true, sort_order: 2, group_key: "outdoors_adventure", group_label: "Outdoors & Adventure", group_sort: 3 },
];

describe("grouping and search helpers", () => {
  it("groups by server-defined group in server order", () => {
    const groups = groupInterests(OPTS);
    expect(groups.map((g) => g.label)).toEqual([
      "Food & Social",
      "Outdoors & Adventure",
      "Sports & Wellness",
    ]);
  });

  it("filters case-insensitively by label", () => {
    expect(filterInterests(OPTS, "yo").map((o) => o.id)).toEqual(["yoga"]);
    expect(filterInterests(OPTS, "").length).toBe(3);
  });
});

describe("meetup interest ranking (mirror of public.meetup_interest_score)", () => {
  it("A. primary overlap outranks additional overlap", () => {
    const primary = meetupInterestScore("coffee", [], ["coffee"]);
    const additional = meetupInterestScore("tech", ["coffee"], ["coffee"]);
    expect(primary).toBeGreaterThan(additional);
  });

  it("B. additional overlap outranks no overlap", () => {
    expect(meetupInterestScore("tech", ["coffee"], ["coffee"])).toBeGreaterThan(
      meetupInterestScore("tech", ["films"], ["coffee"]),
    );
  });

  it("C. a member with no interests gets a deterministic zero interest bonus", () => {
    expect(meetupInterestScore("coffee", ["yoga"], [])).toBe(0);
  });

  it("D. an untagged meetup still scores (no hard filter)", () => {
    expect(meetupInterestScore(null, [], ["coffee"])).toBe(0);
  });

  it("E. interest mismatch never produces a negative penalty", () => {
    expect(meetupInterestScore("films", ["tech"], ["coffee"])).toBe(0);
  });

  it("F. additional-tag credit is capped at two matches", () => {
    expect(meetupInterestScore(null, ["coffee", "yoga", "hiking"], ["coffee", "yoga", "hiking"])).toBe(24);
  });
});
