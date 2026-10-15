import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8790",
      "/vendor": "http://localhost:8790",
      "/healthz": "http://localhost:8790",
      "/llms.txt": "http://localhost:8790",
    },
  },
});
