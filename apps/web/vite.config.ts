import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // API_PORT lets a second checkout, or a machine where something else already
  // holds 8000, run without editing this file.
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT || 8000}` },
  },
  build: { outDir: "dist" },
});
