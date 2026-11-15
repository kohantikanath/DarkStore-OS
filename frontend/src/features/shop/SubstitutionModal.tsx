import { useEffect, useId, useMemo, useRef, useState } from "react";

import { formatPaise } from "../../lib/cart";
import { useChooseSubstitute } from "../../lib/queries";
import type { OrderItem } from "../../types/order";

const SUBSTITUTION_WINDOW_SECONDS = 60;

// The countdown re-renders once a second purely for display — it's always
// computed fresh from expiresAt, never a local 60-second timer (rule 10),
// so a page refresh mid-countdown picks up exactly where the real deadline
// is, not a reset 60 seconds.
function useRemainingSeconds(expiresAt: string): number {
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

// Rendered whenever an order has an item with status AWAITING_SUBSTITUTE —
// derived from order state, not from the WebSocket event itself, so it's
// still showing (with the correct remaining time) after a page refresh.
export function SubstitutionModal({ orderId, item }: { orderId: string; item: OrderItem }) {
  const offer = item.substituteOptions;
  const remaining = useRemainingSeconds(item.expiresAt ?? new Date().toISOString());
  const chooseSubstitute = useChooseSubstitute();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // One key per offer, not per click — re-clicking (a double click, or a
  // retry after a transient failure) must reuse the same key so the server
  // treats it as the same attempt, not a second one. item.id alone would be
  // enough today (an item only ever gets one offer in its lifetime), but
  // keying on expiresAt too means a future offer on the same item — if the
  // state machine ever allowed re-offering — still gets its own key rather
  // than silently reusing a stale one.
  // The deps control *when* to generate a new key (a new offer), not what
  // it's computed from; crypto.randomUUID() never reads item.id/expiresAt,
  // so the rule sees them as "unused" when they're actually the intended
  // cache-busting trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [item.id, item.expiresAt]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  if (!offer) return null;

  const expired = remaining <= 0;

  function handleChoose(productId: string) {
    chooseSubstitute.mutate({ orderId, itemId: item.id, productId, idempotencyKey });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-800">
          One item is out of stock
        </h2>
        <p className="mt-1 text-sm text-slate-500" aria-live="polite">
          {expired
            ? "Time's up — we're refunding this item."
            : `Pick a replacement, or we'll refund it in ${remaining}s.`}
        </p>

        <div className="mt-4 space-y-2">
          {offer.candidates.map((candidate) => (
            <button
              key={candidate.productId}
              type="button"
              onClick={() => handleChoose(candidate.productId)}
              disabled={expired || chooseSubstitute.isPending}
              className="flex w-full items-center justify-between rounded-md border border-slate-200 px-4 py-3 text-left hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-slate-800">{candidate.name}</span>
              <span className="text-sm text-slate-500">{formatPaise(candidate.pricePaise)}</span>
            </button>
          ))}
        </div>

        {chooseSubstitute.isError && (
          <p className="mt-3 text-sm text-red-600">
            Couldn't apply that choice — it may have just expired.
          </p>
        )}

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-amber-500 transition-[width]"
            style={{
              width: `${Math.max(0, Math.min(100, (remaining / SUBSTITUTION_WINDOW_SECONDS) * 100))}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
