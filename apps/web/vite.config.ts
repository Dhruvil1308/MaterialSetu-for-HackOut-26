import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  // Build to the repository root so the bundle lands where a static host looks
  // by default, rather than depending on a per-host output-directory setting.
  build: { outDir: "../../dist", emptyOutDir: true },
});
