import type { ItemStatus, OrderStatus } from "../types/order";

type AnyStatus = OrderStatus | ItemStatus;

// The one place every status gets its color from, order-level and
// item-level alike, so the same status never reads as a different color on
// two screens. Safety yellow is reserved for AWAITING_SUBSTITUTE — the one
// state that's actually asking someone to make a decision right now.
// Text colors are the "-dark" variants, not the base brand colors — fresh,
// alert and safety are all too light to hit 4.5:1 (WCAG AA) as text on
// their own tinted pill background; verified contrast ratios are next to
// each dark token's definition in index.css.
const STATUS_STYLE: Record<AnyStatus, { label: string; className: string }> = {
  // PLACED shares PENDING's neutral treatment, not PICKING's blue — both are
  // "nothing's actively happening yet" states (an order waiting to be picked
  // up, an item waiting to be picked), so crate blue is reserved for the one
  // status that means active, in-progress work.
  PLACED: { label: "Placed", className: "bg-ink/5 text-ink/70" },
  PICKING: { label: "Picking", className: "bg-crate/10 text-crate" },
  PACKED: { label: "Packed", className: "bg-fresh/10 text-fresh-dark" },
  DISPATCHED: { label: "Dispatched", className: "bg-fresh/10 text-fresh-dark" },
  PENDING: { label: "Pending", className: "bg-ink/5 text-ink/70" },
  PICKED: { label: "Picked", className: "bg-fresh/10 text-fresh-dark" },
  AWAITING_SUBSTITUTE: { label: "Awaiting a decision", className: "bg-safety/20 text-safety-dark" },
  SUBSTITUTED: { label: "Substituted", className: "bg-fresh/10 text-fresh-dark" },
  REFUNDED: { label: "Refunded", className: "bg-alert/10 text-alert-dark" },
};

/**
 * One pill, one color per status, reused on the shop tracker, the picker
 * screens, and the ops table. `label` overrides the default text for a
 * screen that needs to phrase the same status from its own point of view
 * (e.g. the picker sees "Awaiting customer", the customer sees "Choosing a
 * replacement") — the color always stays tied to `status`, never to the
 * label.
 */
export function StatusPill({ status, label }: { status: AnyStatus; label?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style.className}`}
    >
      {label ?? style.label}
    </span>
  );
}
