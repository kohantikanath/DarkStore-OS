import { z } from "zod";

export const OrderStatusSchema = z.enum(["PLACED", "PICKING", "PACKED", "DISPATCHED"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const ItemStatusSchema = z.enum([
  "PENDING",
  "PICKED",
  "AWAITING_SUBSTITUTE",
  "SUBSTITUTED",
  "REFUNDED",
]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

// One replacement option offered for a short item — mirrors the backend's
// products.SubstituteCandidate.
export const SubstituteCandidateSchema = z.object({
  productId: z.string(),
  name: z.string(),
  pricePaise: z.number().int().positive(),
});

export type SubstituteCandidate = z.infer<typeof SubstituteCandidateSchema>;

// Stored in (and round-tripped through) order_items.substitute_options
// while an item is AWAITING_SUBSTITUTE.
export const SubstituteOfferSchema = z.object({
  shortQty: z.number().int().positive(),
  candidates: z.array(SubstituteCandidateSchema),
});

export type SubstituteOffer = z.infer<typeof SubstituteOfferSchema>;

export const OrderItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  qty: z.number().int().positive(),
  status: ItemStatusSchema,
  substituteProductId: z.string().optional(),
  substituteOptions: SubstituteOfferSchema.optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  status: OrderStatusSchema,
  version: z.number().int().positive(),
  totalPaise: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  items: z.array(OrderItemSchema),
});

export type Order = z.infer<typeof OrderSchema>;

// The lightweight shape GET /api/orders returns — no items array, so the ops
// table can hold 10,000+ of these without pulling every order's full detail.
// awaitingSubstitution is a derived flag (true if any item on the order is
// AWAITING_SUBSTITUTE), not a stored column — see the backend's
// ListSummaries and lib/cache.ts's orderToSummary — so the ops table can
// highlight a row without the summary needing the full items array.
export const OrderSummarySchema = z.object({
  id: z.string(),
  status: OrderStatusSchema,
  version: z.number().int().positive(),
  totalPaise: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  awaitingSubstitution: z.boolean(),
});

export type OrderSummary = z.infer<typeof OrderSummarySchema>;

export const OrderSummaryListSchema = z.array(OrderSummarySchema);

// What the client is allowed to send when creating an order — just
// productId + qty; the server looks up the price itself.
export interface CreateOrderItem {
  productId: string;
  qty: number;
}

export interface CreateOrderRequest {
  items: CreateOrderItem[];
}

// The shape of a 409 INSUFFICIENT_STOCK error's `details` array.
export const StockShortfallSchema = z.object({
  productId: z.string(),
  requested: z.number().int().positive(),
  available: z.number().int().nonnegative(),
});

export type StockShortfall = z.infer<typeof StockShortfallSchema>;

export const StockShortfallListSchema = z.array(StockShortfallSchema);
