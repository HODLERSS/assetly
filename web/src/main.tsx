import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import "./client.css";
import { installShell } from "./lib/shell";
import { installTapRescue } from "./lib/tapRescue";
import { handOffPortalReturn } from "./lib/native";

// the web brokerage portal's own window: the callback landed here; hand it to the app's tab and close
const handedOff = handOffPortalReturn();
installShell();   // keyboard handling and Dynamic Type, for the whole app
installTapRescue();   // a double tap in the iOS web view acts once instead of not at all

if (!handedOff) createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
