import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const base = process.env.VITE_BASE || "/";

/**
 * When building for the Tauri desktop app (`--mode desktop`):
 * 1. Rewrite index.html BEFORE Vite scans entry scripts (`order: 'pre'`) so
 *    only `src/main-desktop.tsx` is bundled — `MarketingSite.tsx` and
 *    `MarketingSite.css` are 100% excluded from `dist/`.
 * 2. Strip marketing SEO tags and `/media/*` references.
 */
function desktopEntryPlugin(): Plugin {
  const desktopEntry = path.resolve(__dirname, "src/main-desktop.tsx");
  return {
    name: "docusage-desktop-entry",
    enforce: "pre",
    resolveId(source) {
      if (source === "/src/main.tsx" || source.endsWith("/src/main.tsx")) {
        return desktopEntry;
      }
      return null;
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DocuSage</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main-desktop.tsx"></script>
  </body>
</html>`;
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDesktopBuild = mode === "desktop";

  return {
    plugins: [
      ...(isDesktopBuild ? [desktopEntryPlugin()] : []),
      react(),
      tailwindcss(),
    ],
    base: isDesktopBuild ? (command === "build" ? "./" : "/") : base,
    // Exclude public/media/* (~500 KB of marketing screenshots) from desktop bundle
    publicDir: isDesktopBuild ? false : "public",

    build: {
      target: "es2021",
      minify: "esbuild",
      cssMinify: "esbuild",
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },

    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
