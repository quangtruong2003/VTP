import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readdirSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

// Multi-window Tauri app: every *.html in the project root is an entry point
// (overlay.html, settings.html). Output goes to dist/ which tauri.conf.json
// declares as frontendDist.
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: readdirSync(__dirname)
        .filter((f) => f.endsWith(".html"))
        .reduce<Record<string, string>>((acc, f) => {
          acc[f.replace(/\.html$/, "")] = path.resolve(__dirname, f);
          return acc;
        }, {}),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
}));
