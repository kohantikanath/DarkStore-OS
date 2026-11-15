package orders

import "fmt"

type OrderStatus string

const (
	StatusPlaced     OrderStatus = "PLACED"
	StatusPicking    OrderStatus = "PICKING"
	StatusPacked     OrderStatus = "PACKED"
	StatusDispatched OrderStatus = "DISPATCHED"
)

type ItemStatus string

const (
	ItemPending            ItemStatus = "PENDING"
	ItemPicked             ItemStatus = "PICKED"
	ItemAwaitingSubstitute ItemStatus = "AWAITING_SUBSTITUTE"
	ItemSubstituted        ItemStatus = "SUBSTITUTED"
	ItemRefunded           ItemStatus = "REFUNDED"
)

// orderTransitions is the only path an order can take: PLACED -> PICKING ->
// PACKED -> DISPATCHED. No skipping a step, no going back.
var orderTransitions = map[OrderStatus]OrderStatus{
	StatusPlaced:  StatusPicking,
	StatusPicking: StatusPacked,
	StatusPacked:  StatusDispatched,
}

// CanTransitionOrder reports whether an order may move directly from `from`
// to `to`.
func CanTransitionOrder(from, to OrderStatus) bool {
	return orderTransitions[from] == to
}

// itemTransitions: PENDING forks into either the happy path (PICKED) or the
// substitution path (AWAITING_SUBSTITUTE), which itself resolves to exactly
// one of two terminal states. PICKED, SUBSTITUTED, and REFUNDED are all
// terminal — nothing transitions out of them.
var itemTransitions = map[ItemStatus][]ItemStatus{
	ItemPending:            {ItemPicked, ItemAwaitingSubstitute},
	ItemAwaitingSubstitute: {ItemSubstituted, ItemRefunded},
}

// CanTransitionItem reports whether an item may move directly from `from` to
// `to`, ignoring any order-level rules (see CanMarkItemShort for the one
// transition that has one).
func CanTransitionItem(from, to ItemStatus) bool {
	for _, allowed := range itemTransitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

// CanMarkItemShort reports whether an item may be marked short (PENDING ->
// AWAITING_SUBSTITUTE) given the order's current status. Per spec,
// substitution is only allowed while the order itself is PICKING — a picker
// can't mark something short on an order that hasn't started picking yet, or
// one that's already packed.
func CanMarkItemShort(orderStatus OrderStatus, itemStatus ItemStatus) bool {
	return orderStatus == StatusPicking && CanTransitionItem(itemStatus, ItemAwaitingSubstitute)
}

// TransitionError is returned when a requested transition isn't allowed from
// the entity's current state. Handlers map it to 409 Conflict.
type TransitionError struct {
	Entity string // "order" or "item"
	From   string
	To     string
}

func (e *TransitionError) Error() string {
	return fmt.Sprintf("cannot transition %s from %s to %s", e.Entity, e.From, e.To)
}
