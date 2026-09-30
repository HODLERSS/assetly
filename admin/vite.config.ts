import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The admin app reads the same public Supabase URL + publishable key as the consumer app (web/.env.production)
// and the same design tokens (web/src/theme.css). It imports no consumer code.
export default defineConfig({
  plugins: [react()],
  envDir: "../web",
  server: { fs: { allow: [".."] } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});
