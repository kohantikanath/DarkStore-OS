import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";
import { seedHistoricalOrders } from "./db";

const HISTORICAL_ORDER_COUNT = 10_000; // matches backend/cmd/seed, so the ops table demo feels identical either way

export async function startMockWorker(): Promise<void> {
  seedHistoricalOrders(HISTORICAL_ORDER_COUNT);

  const worker = setupWorker(...handlers);
  await worker.start({
    // Vite's own asset/HMR requests aren't API calls we're mocking — let
    // them through instead of logging each one as "unhandled".
    onUnhandledFrame: "bypass",
  });
}
