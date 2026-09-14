import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hodlerss.assetly",
  appName: "Assetly",
  webDir: "dist",
  ios: {
    packageManager: "SPM",
    // the brand ground, so the notch area and rubber-band overscroll match the page
    backgroundColor: "#F4F5F7",
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
  server: {
    // OAuth returns through this scheme; see snaptrade-callback
    iosScheme: "capacitor",
  },
};

export default config;
