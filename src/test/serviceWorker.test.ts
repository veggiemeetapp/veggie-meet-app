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

  it("cleans up obsolete caches and updates only on explicit activation", () => {
    expect(config).toContain("cleanupOutdatedCaches: true");
    // WO-145: no unconditional takeover — Release N activates only when the
    // coordinator posts SKIP_WAITING, so a document never mixes two builds.
    expect(config).toContain('registerType: "prompt"');
    expect(config).not.toContain('registerType: "autoUpdate"');
    expect(config).toContain("skipWaiting: false");
    // WO-145B: never claim already-loaded documents, in either release.
    expect(config).toContain("clientsClaim: false");
  });

  it("WO-145E: ships exactly one prompt-mode release with no migration bridge", () => {
    expect(config).toContain('const PWA_RELEASE = "prompt"');
    expect(config).not.toContain("IS_BRIDGE");
    expect(config).not.toContain("bridgeId");
    expect(config).not.toContain("PWA_RELEASE === ");
    // Clients can still identify the running build without clearing caches.
    expect(config).toContain("release: PWA_RELEASE");
  });

  it("emits a build marker the client can compare against", () => {
    expect(config).toContain('fileName: "version.json"');
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
