// MSW intercepts fetch() at the network layer, so lib/api.ts (the file the
// rest of the app actually calls) needs zero changes for mock mode — these
// handlers just answer the exact same requests it already makes. Patterns
// use a leading "*" so they match regardless of what VITE_API_URL happens
// to be set to.
import { http, HttpResponse } from "msw";

import { broadcastMockEvent } from "../lib/realtime";
import * as db from "./db";
import type { Order } from "../types/order";

const PRODUCTS_ETAG = '"mock-catalog-v1"'; // the mock catalog never changes, so one fixed ETag is enough

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return HttpResponse.json({ error: code, message, details }, { status });
}

/** Shared by the three plain order-status transitions (start-picking/pack/dispatch). */
function transitionHandler(result: db.MockResult<Order>) {
  if (!result.ok) return errorResponse(result.status, result.code, result.message, result.details);
  broadcastMockEvent(result.value, "order.updated");
  return HttpResponse.json(result.value);
}

export const handlers = [
  http.get("*/api/health", () => HttpResponse.json({ status: "ok" })),

  http.get("*/api/products", ({ request }) => {
    if (request.headers.get("If-None-Match") === PRODUCTS_ETAG) {
      return new HttpResponse(null, { status: 304, headers: { ETag: PRODUCTS_ETAG } });
    }
    return HttpResponse.json(db.listProducts(), { headers: { ETag: PRODUCTS_ETAG } });
  }),

  http.post("*/api/orders", async ({ request }) => {
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return errorResponse(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "the Idempotency-Key header is required",
      );
    }

    const stored = db.lookupIdempotency(idempotencyKey);
    if (stored) return HttpResponse.json(stored.body, { status: stored.status });

    const body = (await request.json()) as { items?: { productId: string; qty: number }[] };
    if (!body.items || body.items.length === 0) {
      return errorResponse(400, "VALIDATION_ERROR", "items must not be empty");
    }
    for (const item of body.items) {
      if (!item.productId || item.qty <= 0) {
        return errorResponse(
          400,
          "VALIDATION_ERROR",
          "each item needs a productId and a positive qty",
        );
      }
    }

    const result = db.createOrder(body.items);
    if (!result.ok)
      return errorResponse(result.status, result.code, result.message, result.details);

    db.saveIdempotency(idempotencyKey, 201, result.value);
    broadcastMockEvent(result.value, "order.created");
    return HttpResponse.json(result.value, { status: 201 });
  }),

  http.get("*/api/orders", () => HttpResponse.json(db.listOrderSummaries())),

  http.get("*/api/orders/:id", ({ params }) => {
    const order = db.getOrder(params.id as string);
    if (!order) return errorResponse(404, "ORDER_NOT_FOUND", "no order with that id");
    return HttpResponse.json(order);
  }),

  http.post("*/api/orders/:id/start-picking", ({ params }) =>
    transitionHandler(db.startPicking(params.id as string)),
  ),
  http.post("*/api/orders/:id/pack", ({ params }) =>
    transitionHandler(db.pack(params.id as string)),
  ),
  http.post("*/api/orders/:id/dispatch", ({ params }) =>
    transitionHandler(db.dispatch(params.id as string)),
  ),

  http.post("*/api/orders/:id/items/:itemId/short", async ({ params, request }) => {
    const body = (await request.json()) as { shortQty?: number };
    if (!body.shortQty || body.shortQty < 1) {
      return errorResponse(400, "VALIDATION_ERROR", "shortQty must be at least 1");
    }
    return transitionHandler(
      db.markItemShort(params.id as string, params.itemId as string, body.shortQty),
    );
  }),

  http.post("*/api/orders/:id/items/:itemId/substitute", async ({ params, request }) => {
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return errorResponse(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "the Idempotency-Key header is required",
      );
    }

    const stored = db.lookupIdempotency(idempotencyKey);
    if (stored) return HttpResponse.json(stored.body, { status: stored.status });

    const body = (await request.json()) as { productId?: string };
    if (!body.productId) return errorResponse(400, "VALIDATION_ERROR", "productId is required");

    const result = db.chooseSubstitute(
      params.id as string,
      params.itemId as string,
      body.productId,
    );
    if (!result.ok)
      return errorResponse(result.status, result.code, result.message, result.details);

    db.saveIdempotency(idempotencyKey, 200, result.value);
    broadcastMockEvent(result.value, "order.updated");
    return HttpResponse.json(result.value);
  }),

  http.post("*/api/dev/simulate", () => {
    const result = db.simulateOrder();
    if (!result.ok)
      return errorResponse(result.status, result.code, result.message, result.details);
    broadcastMockEvent(result.value, "order.created");
    return HttpResponse.json(result.value, { status: 201 });
  }),
];
