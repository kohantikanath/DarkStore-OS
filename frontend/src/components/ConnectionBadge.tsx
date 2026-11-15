import { useConnectionStatus } from "../lib/realtime";

// Always visible, not just when something's wrong — a quiet green "Live"
// is itself useful confirmation that the real-time pipeline this whole app
// is built around is actually working right now.
export function ConnectionBadge() {
  const status = useConnectionStatus();
  const isLive = status === "open";

  return (
    <div
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        isLive ? "bg-fresh/10 text-fresh-dark" : "bg-safety/20 text-safety-dark"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-fresh" : "animate-pulse bg-safety-dark"}`}
      />
      {isLive ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting…"}
    </div>
  );
}
