import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WO-122 — guards the service-worker contract at the config level, so a future
 * edit cannot reintroduce cache-first HTML, a second registration path, or a
 * dev-mode worker.
 */
const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
const registrar = readFileSync(
  resolve(process.cwd(), "src/lib/registerServiceWorker.ts"),
  "utf8",
);
const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");

describe("PWA service worker configuration", () => {
  it("uses the maintained generateSW strategy at a single /sw.js path", () => {
    expect(config).toContain('strategies: "generateSW"');
    expect(config).toContain('filename: "sw.js"');
  });

  it("never injects a competing registration and never runs in dev", () => {
    expect(config).toContain("injectRegister: null");
    expect(config).toContain("devOptions: { enabled: false }");
  });

  it("serves navigations Network First with a branded offline fallback", () => {
    expect(config).toContain('handler: "NetworkFirst"');
    expect(config).toContain("networkTimeoutSeconds: 3");
    expect(config).toContain('fallbackURL: "/offline.html"');
    expect(config).toContain("navigateFallback: null");
  });

  it("cleans up obsolete caches and updates predictably", () => {
    expect(config).toContain("cleanupOutdatedCaches: true");
    expect(config).toContain('registerType: "autoUpdate"');
  });

  it("keeps private storage paths out of the image runtime cache", () => {
    expect(config).toContain('!url.pathname.startsWith("/storage/")');
  });

  it("registers only from the guarded wrapper, which honours ?sw=off", () => {
    expect(main).toContain("registerServiceWorker()");
    expect(registrar).toContain("import.meta.env.PROD");
    expect(registrar).toContain('"sw") === "off"');
    expect(registrar).toContain("id-preview--");
    expect(registrar).toContain("unregisterMatching");
  });
});
