import { useEffect, useState } from "react";

// Shared by the customer's substitution bottom sheet and the picker's own
// small countdown on an item awaiting a decision — both need the same
// "seconds left until expiresAt" number, always computed fresh from the
// real deadline (never a local timer), so either view is correct after a
// refresh mid-countdown, not reset to a fresh 60 seconds.
export function useRemainingSeconds(expiresAt: string): number {
  // `now` lives in state (updated by the interval), rather than calling
  // Date.now() directly in the render body — render has to stay pure, so
  // the only place to "sample the clock" is this effect, not the return
  // expression itself.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
}
