import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WakingUpGate } from "./components/WakingUpGate";
import { queryClient } from "./lib/queryClient";
import { initRealtime } from "./lib/realtime";
import "./index.css";

// In mock mode, the MSW worker has to be registered and running *before*
// the app's first render — otherwise the very first health-check/products
// fetch could race ahead of it and hit the real network, which is exactly
// what mock mode exists to avoid depending on.
async function prepare() {
  if (import.meta.env.VITE_USE_MOCK === "true") {
    const { startMockWorker } = await import("./mocks/browser");
    await startMockWorker();
  }
}

prepare().then(() => {
  // One connection (WebSocket, or BroadcastChannel in mock mode) for the
  // whole app's lifetime; see lib/realtime.ts.
  initRealtime(queryClient);

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("#root element is missing from index.html");

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <WakingUpGate>
            <App />
          </WakingUpGate>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
});
