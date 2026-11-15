import { useEffect, useId, useMemo, useRef } from "react";

import { formatPaise, formatPriceDiff } from "../../lib/cart";
import { useChooseSubstitute } from "../../lib/queries";
import { useRemainingSeconds } from "../../lib/useCountdown";
import type { OrderItem } from "../../types/order";
import type { Product } from "../../types/product";

const SUBSTITUTION_WINDOW_SECONDS = 60;

// Rendered whenever an order has an item with status AWAITING_SUBSTITUTE —
// derived from order state, not from the WebSocket event itself, so it's
// still showing (with the correct remaining time) after a page refresh.
// `originalProduct` is looked up by the caller (OrderTrackerPage, from the
// products catalog query it already has) rather than passed as a bare name
// string, since the price-difference-per-candidate line needs the
// original's price too, not just its name.
export function SubstitutionModal({
  orderId,
  item,
  originalProduct,
}: {
  orderId: string;
  item: OrderItem;
  originalProduct: Product | undefined;
}) {
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
  const remainingPct = Math.max(0, Math.min(100, (remaining / SUBSTITUTION_WINDOW_SECONDS) * 100));

  function handleChoose(productId: string) {
    chooseSubstitute.mutate({ orderId, itemId: item.id, productId, idempotencyKey });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl"
      >
        {/* The safety-yellow deadline, draining left to right across the top
            of the sheet — the one place in the whole app that color means
            "a decision is needed right now". */}
        <div className="h-1.5 w-full bg-ink/10">
          <div
            className="h-full bg-safety transition-[width]"
            style={{ width: `${remainingPct}%` }}
          />
        </div>

        <div className="p-6">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {originalProduct ? `${originalProduct.name} is out of stock` : "One item is out of stock"}
          </h2>
          <p className="mt-1 text-sm text-ink/70" aria-live="polite">
            {expired ? (
              "Time's up — we're refunding this item."
            ) : (
              <>
                Pick a replacement, or we'll refund it in{" "}
                <span className="font-display tabular-nums font-semibold text-safety-dark">
                  {remaining}s
                </span>
                .
              </>
            )}
          </p>

          <div className="mt-4 space-y-2">
            {offer.candidates.map((candidate) => (
              <button
                key={candidate.productId}
                type="button"
                onClick={() => handleChoose(candidate.productId)}
                disabled={expired || chooseSubstitute.isPending}
                className="flex w-full items-center justify-between rounded-xl border border-ink/10 px-4 py-3 text-left transition hover:border-crate hover:bg-crate/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-ink">{candidate.name}</span>
                <span className="flex flex-col items-end tabular-nums">
                  <span className="text-sm text-ink/70">{formatPaise(candidate.pricePaise)}</span>
                  {originalProduct && (
                    <span className="text-xs text-ink/70">
                      {formatPriceDiff(candidate.pricePaise - originalProduct.pricePaise)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {chooseSubstitute.isError && (
            <p className="mt-3 text-sm text-alert-dark">
              Couldn't apply that choice — it may have just expired.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
