import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getHealth } from "../lib/api";

// Render's free tier spins the backend down after inactivity; the first
// request after that can take ~50 seconds. Rather than let that show up as
// a blank screen or a confusing error, this blocks on one health check and
// shows a friendly state while it's in flight.
export function WakingUpGate({ children }: { children: ReactNode }) {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: true,
    retryDelay: 2000,
  });

  if (health.isPending) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-ink/15 border-t-crate" />
        <p className="text-ink/70">Waking up the server…</p>
        <p className="max-w-xs text-sm text-ink/70">
          The free hosting tier spins down when idle — this can take up to a minute.
        </p>
      </div>
    );
  }

  if (health.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper text-center">
        <p className="text-ink">Couldn't reach the server.</p>
        <button
          type="button"
          onClick={() => health.refetch()}
          className="rounded-md bg-crate px-4 py-2 font-medium text-white hover:bg-crate-dark"
        >
          Retry
        </button>
      </div>
    );
  }

  return children;
}
