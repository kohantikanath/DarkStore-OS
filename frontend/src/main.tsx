import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WakingUpGate } from "./components/WakingUpGate";
import { queryClient } from "./lib/queryClient";
import { initRealtime } from "./lib/realtime";
import "./index.css";

// One WebSocket connection for the whole app's lifetime; see lib/realtime.ts.
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
