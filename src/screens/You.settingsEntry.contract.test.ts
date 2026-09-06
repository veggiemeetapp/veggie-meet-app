import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WO-146 — the My Profile gear must lead straight to the canonical Settings
 * screen, the intermediary Settings sheet must be gone, and Safety & Trust must
 * have exactly one entry inside Settings (Trust & policies).
 */

const you = readFileSync("src/screens/You.tsx", "utf8");
const settings = readFileSync("src/screens/Settings.tsx", "utf8");

describe("My Profile settings entry", () => {
  it("gear navigates directly to /settings with an accurate accessible name", () => {
    expect(you).toContain('navigate("/settings")');
    expect(you).toContain('aria-label="Open Settings"');
  });

  it("has no intermediary settings sheet left in the DOM or the source", () => {
    expect(you).not.toMatch(/from "@\/components\/ui\/sheet"/);
    expect(you).not.toMatch(/<Sheet[\s>]/);
    expect(you).not.toMatch(/SheetRow/);
    expect(you).not.toMatch(/menuOpen/);
  });

  it("keeps the prominent Edit Profile button on My Profile", () => {
    expect(you).toContain('navigate("/you/edit")');
    expect(you).toContain("Edit Profile");
  });

  it("no longer offers Safety & Trust or Sign out from the profile gear journey", () => {
    expect(you).not.toContain('navigate("/safety")');
    expect(you).not.toContain("Sign Out");
  });
});

describe("Settings safety navigation", () => {
  it("links to /safety exactly once", () => {
    const hits = settings.match(/["']\/safety["']/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("keeps that single entry under Trust & policies", () => {
    expect(settings).toContain('{ to: "/safety", label: "Safety & Trust" }');
  });

  it("keeps Sign out inside Settings", () => {
    expect(settings).toContain("Sign out");
  });
});
