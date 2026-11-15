// The adapter pattern, WebSocket half: this is the ONLY file allowed to open
// a WebSocket. It owns one connection for the whole app, channels components
// ask to subscribe to, and reconnect-with-backoff — components only ever
// call subscribe()/onConnectionChange() and never touch WebSocket directly.
import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "./queryClient";
import { mergeOrder, mergeOrderIntoSummaries } from "./cache";
import { OrderSchema, type Order, type OrderSummary } from "../types/order";

const WS_URL = import.meta.env.VITE_WS_URL;

interface RealtimeEvent {
  type: "order.created" | "order.updated";
  order: unknown;
}

export type ConnectionStatus = "connecting" | "open" | "closed";
type ConnectionListener = (status: ConnectionStatus) => void;

let socket: WebSocket | undefined;
const channels = new Set<string>();
const connectionListeners = new Set<ConnectionListener>();
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let queryClientRef: QueryClient | undefined;
let hasConnectedBefore = false;
let currentStatus: ConnectionStatus = "connecting";

function setStatus(status: ConnectionStatus) {
  currentStatus = status;
  for (const listener of connectionListeners) listener(status);
}

/** The status right now — for a component mounting after the connection already settled. */
export function getConnectionStatus(): ConnectionStatus {
  return currentStatus;
}

function applyEvent(queryClient: QueryClient, raw: unknown) {
  if (typeof raw !== "object" || raw === null || !("order" in raw)) return;
  const event = raw as RealtimeEvent;

  const parsed = OrderSchema.safeParse(event.order);
  if (!parsed.success) return; // malformed/unexpected event — ignore, don't crash the app
  const incoming: Order = parsed.data;

  queryClient.setQueryData<Order>(queryKeys.order(incoming.id), (cached) =>
    mergeOrder(cached, incoming),
  );
  queryClient.setQueryData<OrderSummary[]>(queryKeys.orders, (cached) =>
    mergeOrderIntoSummaries(cached, incoming),
  );
}

function connect() {
  if (socket) return;

  setStatus("connecting");
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    reconnectAttempt = 0;
    setStatus("open");
    for (const channel of channels) {
      socket?.send(JSON.stringify({ type: "subscribe", channel }));
    }

    // Rule: on reconnect (not the first connect), invalidate ['orders'] and
    // any open ['order', id] once. Any event missed while disconnected
    // would otherwise leave stale data sitting in the cache indefinitely,
    // since orders are never polled (staleTime: Infinity) — only a fresh
    // fetch after reconnecting can be sure it's caught up.
    if (hasConnectedBefore && queryClientRef) {
      queryClientRef.invalidateQueries({ queryKey: queryKeys.orders });
      queryClientRef.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "order",
      });
    }
    hasConnectedBefore = true;
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    if (!queryClientRef) return;
    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    applyEvent(queryClientRef, data);
  };

  socket.onclose = () => {
    socket = undefined;
    setStatus("closed");
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

/** Starts the connection. Call once at app startup. */
export function initRealtime(queryClient: QueryClient) {
  queryClientRef = queryClient;
  connect();
}

export function stopRealtime() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = undefined;
}

/** Subscribes to a channel ("ops" or "order:<id>"), resent automatically on reconnect. */
export function subscribe(channel: string) {
  channels.add(channel);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "subscribe", channel }));
  }
}

export function onConnectionChange(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

/** React hook wrapper around onConnectionChange, for showing a "Reconnecting…" badge. */
export function useConnectionStatus(): ConnectionStatus {
  // Lazy initializer, not a hardcoded "connecting": a component mounting
  // after the socket already connected (e.g. navigating to the tracker
  // once the app's already running) should start showing the real status,
  // not wait for the next change event to correct it.
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus);

  useEffect(() => onConnectionChange(setStatus), []);

  return status;
}
