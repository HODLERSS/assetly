import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../web/src/theme.css";
import "./admin.css";
import { AdminApp } from "./App";
import { adminClient } from "./supabase";

createRoot(document.getElementById("root")!).render(<StrictMode><AdminApp sb={adminClient()} /></StrictMode>);
