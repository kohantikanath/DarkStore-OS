import { useConnectionStatus } from "../lib/realtime";

// Shown on any screen that depends on live WebSocket updates (the order
// tracker now, the ops table in Phase 7). Renders nothing once connected —
// it's only meant to explain an otherwise-silent gap in live updates.
export function ConnectionBadge() {
  const status = useConnectionStatus();

  if (status === "open") return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-md bg-amber-100 px-3 py-1 text-sm text-amber-800">
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
      {status === "connecting" ? "Connecting…" : "Reconnecting…"}
    </div>
  );
}
