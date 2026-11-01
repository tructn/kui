import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { loadSettings } from "@/lib/settings-storage";

import "./index.css";

// Settings must be in memory before the persisted stores are created, so the
// app is imported only afterwards. Until then the splash in index.html shows.
async function start() {
  await loadSettings();
  const { App } = await import("@/app/app");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
