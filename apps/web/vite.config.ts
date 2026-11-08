import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Local dev: forward /api to the circle server (server/). Set APP_URL=http://localhost:5173 on the server.
  server: { proxy: { "/product-api": { target: process.env.CONSTELLATE_PRODUCT_API_URL ?? "http://127.0.0.1:8787", rewrite: path => path.replace(/^\/product-api/, "") }, "/api": process.env.CONSTELLATE_SERVER_URL ?? "http://127.0.0.1:3400" } },
  build: {
    target: "es2020",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          motion: ["framer-motion"],
        },
      },
    },
  },
});
