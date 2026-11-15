// Shared TanStack Query hooks, so the staleTime/queryKey rules (rule 3)
// live in exactly one place instead of being repeated at every call site.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createOrder, getOrder, getProducts, listOrders } from "./api";
import { queryKeys } from "./queryClient";
import type { CreateOrderItem } from "../types/order";

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
