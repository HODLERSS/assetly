import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hodlerss.assetly",
  appName: "Assetly",
  webDir: "dist",
  ios: {
    packageManager: "SPM",
    // No backgroundColor here: one fixed colour can only match one theme, and the light one flashed
    // between the dark launch screen and the dark page. AppViewController sets the web view's ground
    // from the "Ground" asset colour, which has a light and a dark value.
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    Keyboard: {
      // "native" shrinks the web view to the space above the keyboard, so bottom-docked chrome (the Ask
      // composer) sits on the keyboard and WebKit never has to scroll the page under the status bar to
      // reveal a field. The tab bar hides while the keyboard is up (lib/keyboard.ts).
      resize: "native",
    },
  },
  server: {
    // OAuth returns through this scheme; see snaptrade-callback
    iosScheme: "capacitor",
  },
};

export default config;
