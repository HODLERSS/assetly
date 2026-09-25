import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Settings > Version reads this. package.json is the one place the version is bumped; keep it equal to the
// iOS MARKETING_VERSION (ios/App/App.xcodeproj). An explicit VITE_APP_VERSION still wins.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const appVersion = process.env.VITE_APP_VERSION ?? pkg.version;

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion) },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
} as never);
