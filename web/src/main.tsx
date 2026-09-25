import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import "./client.css";
import { installShell } from "./lib/shell";
import { installTapRescue } from "./lib/tapRescue";

installShell();   // keyboard handling and Dynamic Type, for the whole app
installTapRescue();   // a double tap in the iOS web view acts once instead of not at all

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
