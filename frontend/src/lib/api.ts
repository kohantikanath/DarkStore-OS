// The adapter pattern: this is the ONLY file in the app allowed to call
// fetch(). Every component goes through the functions exported here (or
// through lib/realtime.ts for live events), so swapping to mock mode
// (Phase 9) means swapping this file's implementation, not touching
// components.
import type { z } from "zod";

import { queryClient } from "./queryClient";
import { queryKeys } from "./queryClient";
import { AppErrorSchema } from "../types/error";
import { ProductListSchema, type Product } from "../types/product";
import {
  OrderSchema,
  OrderSummaryListSchema,
  type Order,
  type OrderSummary,
  type CreateOrderItem,
} from "../types/order";

const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const parsed = AppErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(parsed.data.message, parsed.data.error, res.status, parsed.data.details);
    }
    throw new ApiError(`request failed with status ${res.status}`, "UNKNOWN", res.status);
  }

  const body: unknown = await res.json();
  return schema.parse(body);
}

export async function getHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_URL}/api/health`);
  if (!res.ok) {
    throw new ApiError("backend is not healthy", "DB_UNAVAILABLE", res.status);
  }
  return res.json();
}

// Module-scoped, not component state: the ETag has to survive across every
// query (and every remount), and there's exactly one products list for the
// whole app.
let productsEtag: string | undefined;

export async function getProducts(): Promise<Product[]> {
  const headers: HeadersInit = {};
  if (productsEtag) headers["If-None-Match"] = productsEtag;

  // cache: "no-cache" forces the browser to revalidate with the server
  // instead of serving its own HTTP cache, so a 304 the server sends is
  // actually surfaced here rather than silently resolved to a cached 200.
  const res = await fetch(`${API_URL}/api/products`, { headers, cache: "no-cache" });

  if (res.status === 304) {
    const cached = queryClient.getQueryData<Product[]>(queryKeys.products);
    if (cached) return cached;
    // No cached data to fall back to (shouldn't normally happen) — refetch
    // without the ETag so we get a real body instead of another 304.
    productsEtag = undefined;
    return getProducts();
  }

  if (!res.ok) {
    throw new ApiError("failed to load products", "UNKNOWN", res.status);
  }

  productsEtag = res.headers.get("ETag") ?? undefined;
  const body: unknown = await res.json();
  return ProductListSchema.parse(body);
}

export async function createOrder(
  items: CreateOrderItem[],
  idempotencyKey: string,
): Promise<Order> {
  return request(`/api/orders`, OrderSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ items }),
  });
}

export async function listOrders(): Promise<OrderSummary[]> {
  return request(`/api/orders`, OrderSummaryListSchema);
}

export async function getOrder(id: string): Promise<Order> {
  return request(`/api/orders/${id}`, OrderSchema);
}

export async function startPicking(id: string): Promise<Order> {
  return request(`/api/orders/${id}/start-picking`, OrderSchema, { method: "POST" });
}

export async function packOrder(id: string): Promise<Order> {
  return request(`/api/orders/${id}/pack`, OrderSchema, { method: "POST" });
}

export async function dispatchOrder(id: string): Promise<Order> {
  return request(`/api/orders/${id}/dispatch`, OrderSchema, { method: "POST" });
}

// Creates one order from random catalog items, for the ops screen's
// "Simulate" button — makes a demo's live table look alive on its own. No
// Idempotency-Key: unlike a real checkout, each call is deliberately a new,
// distinct order.
export async function simulateOrder(): Promise<Order> {
  return request(`/api/dev/simulate`, OrderSchema, { method: "POST" });
}
