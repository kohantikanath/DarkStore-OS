import { QueryClient } from "@tanstack/react-query";

// staleTime per the project's caching rules: the product catalog barely
// changes (staleTime 5 minutes, backed by the server's ETag), while orders
// are kept fresh by WebSocket pushes rather than polling or refetching
// (staleTime Infinity — see lib/realtime.ts for how the cache gets patched).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

export const queryKeys = {
  products: ["products"] as const,
  orders: ["orders"] as const,
  order: (id: string) => ["order", id] as const,
};
