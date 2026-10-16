import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app/App";
import { forwardConsoleToLogFile } from "./core/logFile";
import { detectPlatform } from "./core/runtime/runtime";
import "./styles/globals.css";

// The desktop app keeps the webview's warnings and errors in its log file.
if (detectPlatform() === "desktop") forwardConsoleToLogFile();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
