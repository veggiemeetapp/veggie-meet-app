import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // WO-089: stable, non-secret build identifier for operational telemetry and
  // beta feedback. UTC build timestamp only — no branch, token or internal URL.
  define: {
    __APP_VERSION__: JSON.stringify(
      new Date().toISOString().replace(/[-:]/g, "").slice(0, 13) + "Z",
    ),
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
    // WO-122 — production PWA. Exactly one generated worker at /sw.js,
    // registered only from src/lib/registerServiceWorker.ts.
    VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
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
          "**/placeholder.svg",
          "**/assets/QRScanner-*.js",
          "**/assets/Owner*-*.js",
        ],

        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
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
