import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

export default defineConfig(() => ({
  // Allow local development to move Vite's generated cache out of watched folders.
  // This avoids intermittent EBUSY failures from Windows file scanners/editors.
  cacheDir: process.env.PLANE_VITE_CACHE_DIR || path.resolve(__dirname, "../../node_modules/.vite-cache/web"),
  define: {
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // React Router exposes most pages as lazy route modules, so Vite's default
    // entry crawl does not see their dependencies until the first navigation.
    // Scan every route up front to avoid cache rewrites (and Windows EBUSY
    // failures) while a page is being loaded.
    entries: ["app/**/*.{ts,tsx}"],
    include: ["export-to-csv"],
  },
  plugins: [reactRouter(), tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
  resolve: {
    alias: {
      // Next.js compatibility shims used within web
      "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
      "next/script": path.resolve(__dirname, "app/compat/next/script.tsx"),
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  server: {
    host: "127.0.0.1",
  },
  // No SSR-specific overrides needed; alias resolves to ESM build
}));
