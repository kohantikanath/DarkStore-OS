// Shared TanStack Query hooks, so the staleTime/queryKey rules (rule 3)
// live in exactly one place instead of being repeated at every call site.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  chooseSubstitute,
  createOrder,
  dispatchOrder,
  getOrder,
  getProducts,
  listOrders,
  markItemShort,
  packOrder,
  startPicking,
} from "./api";
import { mergeOrder, rollbackOrder } from "./cache";
import { queryKeys } from "./queryClient";
import type { CreateOrderItem, Order } from "../types/order";

const FIVE_MINUTES = 5 * 60 * 1000;

export function useProducts() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: getProducts,
    staleTime: FIVE_MINUTES,
  });
}

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.order(orderId),
    queryFn: () => getOrder(orderId),
    // Infinity: this order's freshness comes from the WebSocket (see
    // lib/realtime.ts), never from polling or refetch-on-focus.
    staleTime: Infinity,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: queryKeys.orders,
    queryFn: listOrders,
    // Same reasoning as useOrder: the ops table is kept fresh by the "ops"
    // WebSocket channel, not by polling — fetched once, then patched.
    staleTime: Infinity,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ items, idempotencyKey }: { items: CreateOrderItem[]; idempotencyKey: string }) =>
      createOrder(items, idempotencyKey),
    onSuccess: (order) => {
      // Seed the order cache immediately so navigating to the tracker shows
      // data right away instead of a loading flash while it refetches.
      queryClient.setQueryData(queryKeys.order(order.id), order);
    },
  });
}

// Shared shape for the picker's order-status mutations (rule 6: optimistic
// updates with rollback for picker actions). Each one optimistically
// applies its own effect on the cached order immediately, writes the real
// response into the cache the moment it arrives (not just whatever the
// WebSocket happens to deliver later), and rolls back to the pre-mutation
// snapshot on failure — but only if nothing newer has landed meanwhile.
function useOrderTransition(
  mutationFn: (orderId: string) => Promise<Order>,
  applyOptimistic: (order: Order) => Order,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (orderId: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.order(orderId) });
      const previous = queryClient.getQueryData<Order>(queryKeys.order(orderId));
      if (previous) {
        queryClient.setQueryData<Order>(queryKeys.order(orderId), applyOptimistic(previous));
      }
      return { previous, orderId };
    },
    onSuccess: (order) => {
      queryClient.setQueryData<Order>(queryKeys.order(order.id), (cached) =>
        mergeOrder(cached, order),
      );
    },
    onError: (_err, _orderId, context) => {
      const snapshot = context?.previous;
      if (!snapshot) return;
      queryClient.setQueryData<Order>(queryKeys.order(context.orderId), (cached) =>
        rollbackOrder(cached, snapshot),
      );
    },
  });
}

export function useStartPicking() {
  return useOrderTransition(startPicking, (order) => ({ ...order, status: "PICKING" }));
}

export function usePackOrder() {
  return useOrderTransition(packOrder, (order) => ({
    ...order,
    status: "PACKED",
    // Mirrors the server's own bulk-finalize: there's no separate "mark
    // picked" action, so packing is what turns any still-PENDING item into
    // PICKED (see backend/internal/orders/repository.go).
    items: order.items.map((item) =>
      item.status === "PENDING" ? { ...item, status: "PICKED" } : item,
    ),
  }));
}

export function useDispatchOrder() {
  return useOrderTransition(dispatchOrder, (order) => ({ ...order, status: "DISPATCHED" }));
}

// Picker action: mark an item short. Optimistically flips it to
// AWAITING_SUBSTITUTE so the picker sees it move immediately; the real
// substitute options/expiresAt (which the client can't guess — the server
// picks the candidates) arrive via the mutation's own response, merged into
// the cache in onSuccess rather than waiting on a WebSocket round trip.
export function useMarkItemShort() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      itemId,
      shortQty,
    }: {
      orderId: string;
      itemId: string;
      shortQty: number;
    }) => markItemShort(orderId, itemId, shortQty),
    onMutate: async ({ orderId, itemId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.order(orderId) });
      const previous = queryClient.getQueryData<Order>(queryKeys.order(orderId));
      if (previous) {
        queryClient.setQueryData<Order>(queryKeys.order(orderId), {
          ...previous,
          items: previous.items.map((item) =>
            item.id === itemId ? { ...item, status: "AWAITING_SUBSTITUTE" as const } : item,
          ),
        });
      }
      return { previous, orderId };
    },
    onSuccess: (order) => {
      queryClient.setQueryData<Order>(queryKeys.order(order.id), (cached) =>
        mergeOrder(cached, order),
      );
    },
    onError: (_err, _vars, context) => {
      const snapshot = context?.previous;
      if (!snapshot) return;
      queryClient.setQueryData<Order>(queryKeys.order(context.orderId), (cached) =>
        rollbackOrder(cached, snapshot),
      );
    },
  });
}

// Customer action: choose a substitute. Optimistically marks the item
// SUBSTITUTED with the chosen product, so the popup closes the instant the
// customer clicks rather than waiting on the round trip.
export function useChooseSubstitute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      itemId,
      productId,
      idempotencyKey,
    }: {
      orderId: string;
      itemId: string;
      productId: string;
      idempotencyKey: string;
    }) => chooseSubstitute(orderId, itemId, productId, idempotencyKey),
    onMutate: async ({ orderId, itemId, productId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.order(orderId) });
      const previous = queryClient.getQueryData<Order>(queryKeys.order(orderId));
      if (previous) {
        queryClient.setQueryData<Order>(queryKeys.order(orderId), {
          ...previous,
          items: previous.items.map((item) =>
            item.id === itemId
              ? { ...item, status: "SUBSTITUTED" as const, substituteProductId: productId }
              : item,
          ),
        });
      }
      return { previous, orderId };
    },
    onSuccess: (order) => {
      queryClient.setQueryData<Order>(queryKeys.order(order.id), (cached) =>
        mergeOrder(cached, order),
      );
    },
    onError: (_err, _vars, context) => {
      const snapshot = context?.previous;
      if (!snapshot) return;
      queryClient.setQueryData<Order>(queryKeys.order(context.orderId), (cached) =>
        rollbackOrder(cached, snapshot),
      );
    },
  });
}
