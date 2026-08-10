import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

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
