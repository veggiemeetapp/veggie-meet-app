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

  it("cleans up obsolete caches and updates only through coordinated activation", () => {
    expect(config).toContain("cleanupOutdatedCaches: true");
    // WO-145: no unconditional takeover — Release N activates only when the
    // coordinator posts SKIP_WAITING only when safe, so a document never mixes
    // two builds even though activation is automatic for a clean client.
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

  it("WO-145F: the worker exposes a bounded, anonymous fleet helper", () => {
    const fleetWorker = readFileSync(
      resolve(process.cwd(), "public/sw-fleet.js"),
      "utf8",
    );
    expect(config).toContain('importScripts: ["sw-fleet.js"]');
    // Real client set + anonymous diagnostics only.
    expect(fleetWorker).toContain("CLIENT_CENSUS");
    expect(fleetWorker).toContain("clients.matchAll");
    expect(fleetWorker).toContain("UPDATE_DIAGNOSTICS");
    // It must never take over documents, unregister, or own promotion.
    expect(fleetWorker).not.toContain("clientsClaim");
    expect(fleetWorker).not.toContain("unregister");
    expect(fleetWorker).not.toContain("self.skipWaiting()");
    // No URLs, bodies, headers or auth material may leave the worker.
    expect(fleetWorker).not.toContain("request.url,");
    expect(fleetWorker).not.toContain("Authorization");
  });

  it("WO-145F: no production path ever unregisters the worker", () => {
    const coordinator = readFileSync(
      resolve(process.cwd(), "src/lib/pwaUpdate.ts"),
      "utf8",
    );
    const hook = readFileSync(
      resolve(process.cwd(), "src/hooks/usePwaUpdate.tsx"),
      "utf8",
    );
    // Comments may discuss it; no path may CALL it.
    expect(coordinator).not.toMatch(/\.unregister\s*\(/);
    expect(hook).not.toMatch(/\.unregister\s*\(/);
  });

  it("automatically applies a detected build only through the safety policy", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "src/hooks/usePwaUpdate.tsx"),
      "utf8",
    );
    expect(hook).toContain("shouldApplyUpdateAutomatically({");
    expect(hook).toContain("subscribeUnsavedWork");
    expect(hook).toContain("useIsMutating");
    expect(hook).toContain("automaticAttemptRef.current = automaticUpdateKey");
    expect(hook).toContain("updateNow({ automatic: true });");
    expect(hook).toContain('state.status !== "pending-close"');
    expect(hook).toContain("continueOnCurrentVersion();");
  });
});
