import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./frontend") },
  },
  // Assets load from disk inside the Tauri app, so bundle size warnings meant for the web don't apply.
  build: { chunkSizeWarningLimit: 2000 },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // The Rust side (app/, crates/, target/) is rebuilt by Tauri, not Vite. Anchored
    // to the repo root so the frontend's own `frontend/app/` is still watched.
    watch: { ignored: ["app", "crates", "target"].map((dir) => `${import.meta.dirname}/${dir}/**`) },
  },
}));
