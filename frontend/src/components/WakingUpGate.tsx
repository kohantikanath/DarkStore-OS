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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
        <p className="text-slate-600">Waking up the server…</p>
        <p className="max-w-xs text-sm text-slate-400">
          The free hosting tier spins down when idle — this can take up to a minute.
        </p>
      </div>
    );
  }

  if (health.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-slate-800">Couldn't reach the server.</p>
        <button
          type="button"
          onClick={() => health.refetch()}
          className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return children;
}
