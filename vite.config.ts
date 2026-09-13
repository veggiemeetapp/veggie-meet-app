import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { VitePWA } from "vite-plugin-pwa";

// WO-089/WO-145: one immutable, non-secret build identifier per build. It is a
// UTC build timestamp only — no branch, token, credential or internal URL. The
// same value is injected into the client (`__APP_VERSION__`) and emitted to
// `/version.json`, so a client can always compare "what I loaded" with "what the
// origin serves" and report a stale document instead of guessing.
const BUILD_ID = new Date().toISOString().replace(/[-:.]/g, "");

// The plugin stays in prompt mode so activation is owned by the app's automatic
// coordinator: wait for protected work to finish, activate, then reload once.
const PWA_RELEASE = "prompt";

/** Emits an uncached, non-secret build marker consumed by the update coordinator. */
function versionManifestPlugin(): Plugin {
  return {
    name: "veggiemeet-version-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({
          buildId: BUILD_ID,
          release: PWA_RELEASE,
        }),
      });
    },
  };
}


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_ID),
    __PWA_RELEASE__: JSON.stringify(PWA_RELEASE),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mcpPlugin(),
    versionManifestPlugin(),
    // WO-122 — production PWA. Exactly one generated worker at /sw.js,
    // registered only from src/lib/registerServiceWorker.ts.
    // WO-145 — `prompt` (not `autoUpdate`) + `skipWaiting: false`. An
    // unconditional skipWaiting activated a new worker underneath a running old
    // document, so the member kept seeing the old build while its caches moved
    // to the new one, and old HTML could request new lazy chunks. The new worker
    // now waits until the client coordinator posts SKIP_WAITING when the app is
    // safe, then reloads exactly once so old and new code never execute together.
    VitePWA({
      strategies: "generateSW",
      // WO-145D/E measured behaviour: the plugin's auto-update register type
      // makes vite-plugin-pwa inject `clientsClaim()` into the generated worker
      // even when `workbox.clientsClaim` is false, which would take over an
      // already-loaded document. `prompt` is therefore mandatory; the plugin
      // never injects a registration (`injectRegister: null`).
      registerType: "prompt",
      injectRegister: null,
      filename: "sw.js",
      devOptions: { enabled: false },
      // The manifest and icons are owned by public/manifest.webmanifest and
      // were verified in WO-114/WO-118 — do not regenerate them here.
      manifest: false,
      includeAssets: [
        "favicon.ico",
        "favicon.png",
        "apple-touch-icon.png",
        "manifest.webmanifest",
        "app-icon-192.png",
        "app-icon-512.png",
        "app-icon-maskable-512.png",
        "offline.html",
      ],
      workbox: {
        // Precache only the versioned app shell and essential static assets.
        globPatterns: ["**/*.{js,css,html,woff,woff2,svg,ico,png}"],
        // Keep the precache to the boot shell: heavy, rarely-used route chunks
        // (QR scanner, owner-only tooling) are fetched on demand and handled by
        // the runtime asset cache instead.
        globIgnores: [
          // precacheAndRoute handles '/' as '/index.html' BEFORE runtime rules.
          // Exclude HTML entry points so ordinary reloads really use the network.
          "**/index.html",
          "**/placeholder.svg",
          "**/assets/QRScanner-*.js",
          "**/assets/Owner*-*.js",
        ],

        // WO-145F — fleet preparation support inside the worker. It adds only a
        // message handler (real client census via `clients.matchAll()`) and
        // passive, anonymous fetch/lifecycle counters used to attribute a
        // stalled transition. It never changes routing, caching or activation.
        importScripts: ["sw-fleet.js"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // WO-145B — `clientsClaim: false` is required, not cosmetic. With it
        // enabled, a newly activated worker immediately took control of the
        // OLD documents, so build N's JavaScript kept running while its
        // requests were served by build N+1's caches — the mixed-build state
        // WO-145's closeout claimed to prevent. A client now stays with the
        // worker that loaded it and only ever sees the new build after its own
        // one-time, coordinated reload.
        clientsClaim: false,
        // WO-145E: activation is coordinator-controlled. The worker waits until
        // the app is visible and free of unsaved work/mutations before the
        // coordinator posts SKIP_WAITING. Nothing is ever unregistered.
        skipWaiting: false,

        // Workbox registers a NavigationRoute BEFORE runtimeCaching, so the
        // plugin's default `navigateFallback: index.html` would shadow the
        // Network First HTML rule and pin every navigation to a cached
        // document. It is disabled; the branded fallback is attached to the
        // navigation route itself via `precacheFallback`.
        navigateFallback: null,

        runtimeCaching: [
          {
            // HTML/navigations: Network First with a short timeout so a new
            // release is never permanently pinned. On total failure (no network
            // and no cached document) the branded offline page is served.
            // OAuth and backend paths are excluded so they always hit network.
            urlPattern: ({ request, sameOrigin, url }) =>
              sameOrigin &&
              request.mode === "navigate" &&
              !/^\/(~oauth|\.lovable\/|functions\/|auth\/)/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "veggiemeet-html-v1",
              fetchOptions: { cache: "no-store" },
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
              precacheFallback: { fallbackURL: "/offline.html" },
            },
          },

          {
            // Versioned same-origin build assets (hashed filenames).
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && ["script", "style", "font"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "veggiemeet-assets-v1",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Public, same-origin static images only (icons, brand art).
            // Signed/private storage URLs are cross-origin and never match.
            urlPattern: ({ request, sameOrigin, url }) =>
              sameOrigin &&
              request.destination === "image" &&
              !url.pathname.startsWith("/storage/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "veggiemeet-images-v1",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),

  build: {
    // WO-086 DEF-086-02: stable vendor chunking. Previously every framework
    // dependency shared one 725 kB entry chunk, so any app edit invalidated the
    // whole download and boot had to parse it in one task.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return "vendor-react";
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("@supabase") || id.includes("@lovable.dev")) return "vendor-supabase";
          if (id.includes("@radix-ui")) return "vendor-radix";
          // Everything else keeps Rollup's per-entry splitting so route-only
          // libraries (e.g. the QR decoder) stay out of the boot path.
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
