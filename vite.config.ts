import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  // Read API_PORT from .env as well as the shell (loadEnv with "" prefix exposes non-VITE_ vars to this file only).
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.API_PORT || "4000";

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin in dev: the browser only talks to Vite, which proxies /api to Express.
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
