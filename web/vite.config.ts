import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the UI runs on :5173 and the API on :8000 (make run); these paths are proxied so the app can use
// relative URLs either way. A separately hosted build sets VITE_API_BASE instead (src/api/client.ts).
const API = "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  // The 3D graph's three.js chunk is ~1.4 MB, but it is lazy-loaded by the Graph view alone.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/discover", "/collection", "/health", "/docs", "/openapi.json"].map((p) => [p, API])),
  },
});
