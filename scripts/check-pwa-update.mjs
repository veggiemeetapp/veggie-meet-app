/**
 * Real-browser regression check against two production builds, without login.
 *
 * npm run build -- --outDir /tmp/pwa-a
 * npm run build -- --outDir /tmp/pwa-b
 * PWA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/check-pwa-update.mjs /tmp/pwa-a /tmp/pwa-b
 *
 * Each case gets isolated browser storage. Only the page's poll timer is
 * accelerated; real service workers, requests and navigation stay untouched.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const playwright = await import(process.env.PWA_PLAYWRIGHT_MODULE || "playwright");
assert(process.argv[2] && process.argv[3], "Pass two production build directories.");
const [first, second] = process.argv.slice(2, 4).map((dir) => path.resolve(dir));
const firstBuild = JSON.parse(await readFile(path.join(first, "version.json"))).buildId;
const secondBuild = JSON.parse(await readFile(path.join(second, "version.json"))).buildId;
assert.notEqual(firstBuild, secondBuild, "The two builds must have distinct version IDs.");
let directory = first;
const types = {
  ".js": "text/javascript", ".html": "text/html", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  let file = path.join(directory, pathname === "/" ? "index.html" : pathname);
  try {
    let body;
    try {
      body = await readFile(file);
    } catch {
      if (pathname.startsWith("/assets/")) {
        // Retain old hashed assets, so a missing chunk cannot trigger recovery
        // and falsely pass a test of ordinary automatic update discovery.
        body = await readFile(path.join(first, pathname));
      } else if (!path.extname(pathname)) {
        file = path.join(directory, "index.html");
        body = await readFile(file);
      } else {
        res.writeHead(404); res.end(); return;
      }
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright[process.env.PWA_BROWSER || "chromium"].launch({ headless: true });
try {
  for (const scenario of [
    { name: "first visit, no controller", controlled: false },
    { name: "open desktop tab", controlled: true },
    { name: "foreground focus", controlled: true, event: "focus" },
    { name: "PWA pageshow resume", controlled: true, event: "pageshow" },
    { name: "mobile viewport", controlled: true, mobile: true },
  ]) {
    directory = first;
    const context = await browser.newContext(scenario.mobile
      ? { isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } }
      : {});
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.goto(origin + "/privacy");
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(async () =>
        (await navigator.serviceWorker.getRegistration())?.active?.state === "activated");
      if (scenario.controlled) await page.reload();
      // Let the initial version check settle before simulating a deployment.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      assert.equal(await page.evaluate(() => localStorage.getItem("veggiemeet_build_id")), firstBuild);
      assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), scenario.controlled);

      let navigations = 0;
      // history.replaceState (marker cleanup + router state) also emits
      // framenavigated. Count actual new documents instead of same-page changes.
      page.on("domcontentloaded", () => { navigations++; });
      directory = second;
      const began = Date.now();
      // Resume within the old 60s debounce to prove that bug is also fixed.
      await page.clock.fastForward(scenario.event ? 6_000 : 61_000);
      if (scenario.event) await page.evaluate((event) => window.dispatchEvent(new Event(event)), scenario.event);
      await page.waitForFunction((build) => localStorage.getItem("veggiemeet_build_id") === build, secondBuild, { timeout: 20_000 });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.equal(new URL(page.url()).pathname, "/privacy");
      assert.equal(new URL(page.url()).searchParams.has("_vm_update"), false);
      assert.equal(navigations, 1, "Exactly one update navigation, no reload loop");
      console.log(`PASS ${scenario.name}: ${firstBuild} -> ${secondBuild}; ${Date.now() - began}ms; one automatic reload`);
    } finally { await context.close(); }
  }

  directory = first;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin + "/privacy");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(() => window.history.replaceState(null, "", "/"));
    directory = second;
    const response = await page.reload();
    assert.equal(await response.text(), await readFile(path.join(second, "index.html"), "utf8"));
    console.log("PASS ordinary root reload: incoming HTML is from the server, not the old precache");
  } finally { await context.close(); }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
