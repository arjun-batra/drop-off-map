import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiDevMiddleware } from "./scripts/viteApiMiddleware";

export default defineConfig(({ mode }) => {
  // The api/**.ts handlers read process.env directly (matching Vercel's
  // runtime), so local dev needs .env.local's values copied onto
  // process.env -- Vite's own env loading only exposes VITE_-prefixed vars
  // to client code via import.meta.env, which doesn't help server handlers.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [react(), apiDevMiddleware()],
    test: {
      environment: "jsdom",
      include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    },
  };
});
