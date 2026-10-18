import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Lets any origin read the plugin frame shell: its frames have the opaque origin
 * null and load shell.js as a CORS request.
 */
function pluginFrameCors(): Plugin {
  const allow = (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (req.url?.startsWith("/plugin-frame/")) res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  };
  return {
    name: "rim-plugin-frame-cors",
    configureServer: (server) => void server.middlewares.use(allow),
    configurePreviewServer: (server) => void server.middlewares.use(allow),
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), pluginFrameCors()],

  // The app's version, which plugins get as `hostVersion`.
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // GraphQL runtime — stable, rarely changes, benefits from separate cache entry
          if (
            id.includes("node_modules/graphql/") ||
            id.includes("node_modules/graphql-request/") ||
            id.includes("node_modules/graphql-ws/")
          ) {
            return "vendor-graphql";
          }
          // React ecosystem — large, stable
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
