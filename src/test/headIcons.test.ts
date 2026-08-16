/**
 * WO-114 DEF-114-01 — icon delivery regression guard.
 *
 * Production served a non-VeggieMeet host-default icon because no
 * /favicon.ico existed in the deployed artifact. These assertions are static
 * (no browser pixels): every icon referenced from the head, and every manifest
 * icon, must exist in public/ and use a root-absolute path.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const html = readFileSync(resolve(root, "index.html"), "utf8");

function hrefs(rel: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<link[^>]*rel="${rel}"[^>]*>`, "g");
  for (const tag of html.match(re) ?? []) {
    const m = tag.match(/href="([^"]+)"/);
    if (m) out.push(m[1]);
  }
  return out;
}

describe("head icon delivery", () => {
  const icons = hrefs("icon");

  it("declares a favicon.ico plus a modern png", () => {
    expect(icons).toContain("/favicon.ico");
    expect(icons).toContain("/favicon.png");
  });

  it("declares an apple touch icon", () => {
    expect(hrefs("apple-touch-icon")).toEqual(["/apple-touch-icon.png"]);
  });

  it("resolves every head icon to a root-safe file in public/", () => {
    for (const href of [...icons, ...hrefs("apple-touch-icon")]) {
      expect(href.startsWith("/")).toBe(true);
      expect(existsSync(resolve(root, "public", href.slice(1)))).toBe(true);
    }
  });

  it("resolves every manifest icon", () => {
    const [manifestHref] = hrefs("manifest");
    expect(manifestHref).toBe("/manifest.webmanifest");
    const manifest = JSON.parse(
      readFileSync(resolve(root, "public", "manifest.webmanifest"), "utf8"),
    ) as { name: string; short_name: string; icons: { src: string }[] };
    expect(manifest.short_name).toBe("VeggieMeet");
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(existsSync(resolve(root, "public", icon.src.slice(1)))).toBe(true);
    }
  });
});
