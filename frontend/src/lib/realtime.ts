// The adapter pattern, live-events half: this is the ONLY file allowed to
// open a WebSocket (or, in mock mode, a BroadcastChannel). It owns one
// connection for the whole app, channels components ask to subscribe to,
// and reconnect-with-backoff — components only ever call
// subscribe()/onConnectionChange() and never touch either transport
// directly, and never need to know which one is actually in use.
import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "./queryClient";
import { mergeOrder, mergeOrderIntoSummaries } from "./cache";
import { OrderSchema, type Order, type OrderSummary } from "../types/order";

const WS_URL = import.meta.env.VITE_WS_URL;
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

// BroadcastChannel has no server, no subscriptions, and no concept of
// "ops" vs "order:<id>" — every tab on this channel receives every event
// and just patches whatever's in its own cache (applyEvent below doesn't
// care how an event arrived), so one shared channel name stands in for
// every real channel at once.
const MOCK_CHANNEL_NAME = "darkstore-os-mock-events";

interface RealtimeEvent {
  type: "order.created" | "order.updated";
  order: unknown;
}

export type ConnectionStatus = "connecting" | "open" | "closed";
type ConnectionListener = (status: ConnectionStatus) => void;

let socket: WebSocket | undefined;
let mockChannel: BroadcastChannel | undefined;
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

function connectMock() {
  if (mockChannel) return;

  mockChannel = new BroadcastChannel(MOCK_CHANNEL_NAME);
  mockChannel.onmessage = (event: MessageEvent<RealtimeEvent>) => {
    if (queryClientRef) applyEvent(queryClientRef, event.data);
  };
  // A BroadcastChannel has no handshake and nothing to reconnect — it's
  // either been created (open) or it hasn't.
  setStatus("open");
}

/** Starts the connection (real WebSocket, or BroadcastChannel in mock mode). Call once at app startup. */
export function initRealtime(queryClient: QueryClient) {
  queryClientRef = queryClient;
  if (USE_MOCK) {
    connectMock();
  } else {
    connect();
  }
}

export function stopRealtime() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = undefined;
  mockChannel?.close();
  mockChannel = undefined;
}

/** Subscribes to a channel ("ops" or "order:<id>"), resent automatically on reconnect. */
export function subscribe(channel: string) {
  // Nothing to send in mock mode: every tab on the BroadcastChannel already
  // receives every event, so there's no server-side subscription to ask for.
  if (USE_MOCK) return;

  channels.add(channel);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "subscribe", channel }));
  }
}

/**
 * Lets the mock request handlers (mocks/handlers.ts) announce a change to
 * every tab, including this one. A real WebSocket broadcast reaches the
 * connection that caused it too (the server doesn't know or care which
 * connection sent the HTTP request that triggered it), but BroadcastChannel
 * specifically never delivers a tab's own postMessage back to itself — so
 * without this, the acting tab's own mutations (which only optimistically
 * patch ['order', id], not fields like substituteOptions that only the
 * server can compute, nor the ['orders'] ops list) would never see the
 * authoritative result unless some OTHER tab happened to be open. Applying
 * the event locally keeps this tab consistent with what every other tab
 * gets. A no-op outside mock mode.
 */
export function broadcastMockEvent(order: Order, type: RealtimeEvent["type"]) {
  if (!USE_MOCK) return;
  connectMock(); // safe no-op if already connected; guarantees a channel exists
  const event: RealtimeEvent = { type, order };
  if (queryClientRef) applyEvent(queryClientRef, event);
  mockChannel?.postMessage(event);
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
