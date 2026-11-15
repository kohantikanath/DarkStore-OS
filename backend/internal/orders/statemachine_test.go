package orders

import (
	"testing"
	"time"
)

// Every pair is listed explicitly (not derived from orderTransitions) so
// this test actually checks the state machine against the spec, rather than
// checking the map against itself.
func TestCanTransitionOrder(t *testing.T) {
	allStatuses := []OrderStatus{StatusPlaced, StatusPicking, StatusPacked, StatusDispatched}

	allowed := map[[2]OrderStatus]bool{
		{StatusPlaced, StatusPicking}:    true,
		{StatusPicking, StatusPacked}:    true,
		{StatusPacked, StatusDispatched}: true,
	}

	for _, from := range allStatuses {
		for _, to := range allStatuses {
			want := allowed[[2]OrderStatus{from, to}]
			got := CanTransitionOrder(from, to)
			if got != want {
				t.Errorf("CanTransitionOrder(%s, %s) = %v, want %v", from, to, got, want)
			}
		}
	}
}

func TestCanTransitionItem(t *testing.T) {
	allStatuses := []ItemStatus{
		ItemPending, ItemPicked, ItemAwaitingSubstitute, ItemSubstituted, ItemRefunded,
	}

	allowed := map[[2]ItemStatus]bool{
		{ItemPending, ItemPicked}:                 true,
		{ItemPending, ItemAwaitingSubstitute}:     true,
		{ItemAwaitingSubstitute, ItemSubstituted}: true,
		{ItemAwaitingSubstitute, ItemRefunded}:    true,
	}

	for _, from := range allStatuses {
		for _, to := range allStatuses {
			want := allowed[[2]ItemStatus{from, to}]
			got := CanTransitionItem(from, to)
			if got != want {
				t.Errorf("CanTransitionItem(%s, %s) = %v, want %v", from, to, got, want)
			}
		}
	}
}

func TestCanMarkItemShort(t *testing.T) {
	tests := []struct {
		orderStatus OrderStatus
		itemStatus  ItemStatus
		want        bool
	}{
		// Only PENDING items on a PICKING order can be marked short.
		{StatusPicking, ItemPending, true},
		{StatusPlaced, ItemPending, false},
		{StatusPacked, ItemPending, false},
		{StatusDispatched, ItemPending, false},
		// Even while PICKING, an item that's already resolved can't be
		// marked short again.
		{StatusPicking, ItemPicked, false},
		{StatusPicking, ItemAwaitingSubstitute, false},
		{StatusPicking, ItemSubstituted, false},
		{StatusPicking, ItemRefunded, false},
	}

	for _, tt := range tests {
		got := CanMarkItemShort(tt.orderStatus, tt.itemStatus)
		if got != tt.want {
			t.Errorf("CanMarkItemShort(%s, %s) = %v, want %v", tt.orderStatus, tt.itemStatus, got, tt.want)
		}
	}
}

func TestCanPackOrder(t *testing.T) {
	tests := []struct {
		name        string
		orderStatus OrderStatus
		awaiting    bool
		want        bool
	}{
		{"picking, nothing awaiting", StatusPicking, false, true},
		{"picking, one item awaiting", StatusPicking, true, false},
		{"placed, nothing awaiting", StatusPlaced, false, false},
		{"packed, nothing awaiting", StatusPacked, false, false},
		{"dispatched, nothing awaiting", StatusDispatched, false, false},
	}

	for _, tt := range tests {
		got := CanPackOrder(tt.orderStatus, tt.awaiting)
		if got != tt.want {
			t.Errorf("%s: CanPackOrder(%s, %v) = %v, want %v", tt.name, tt.orderStatus, tt.awaiting, got, tt.want)
		}
	}
}

func TestCanChooseSubstitute(t *testing.T) {
	allOrderStatuses := []OrderStatus{StatusPlaced, StatusPicking, StatusPacked, StatusDispatched}
	allItemStatuses := []ItemStatus{
		ItemPending, ItemPicked, ItemAwaitingSubstitute, ItemSubstituted, ItemRefunded,
	}

	// Only an AWAITING_SUBSTITUTE item on a still-PICKING order may be
	// resolved by a substitution choice.
	allowed := map[[2]any]bool{
		{StatusPicking, ItemAwaitingSubstitute}: true,
	}

	for _, orderStatus := range allOrderStatuses {
		for _, itemStatus := range allItemStatuses {
			want := allowed[[2]any{orderStatus, itemStatus}]
			got := CanChooseSubstitute(orderStatus, itemStatus)
			if got != want {
				t.Errorf("CanChooseSubstitute(%s, %s) = %v, want %v", orderStatus, itemStatus, got, want)
			}
		}
	}
}

func TestIsDueForExpiry(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	past := now.Add(-1 * time.Second)
	future := now.Add(1 * time.Second)

	tests := []struct {
		name      string
		status    ItemStatus
		expiresAt *time.Time
		want      bool
	}{
		{"awaiting substitute, deadline passed", ItemAwaitingSubstitute, &past, true},
		{"awaiting substitute, deadline not yet reached", ItemAwaitingSubstitute, &future, false},
		{"awaiting substitute, no deadline set", ItemAwaitingSubstitute, nil, false},
		// The customer chose (or it was already refunded) before the ticker
		// got to it — a past deadline on a resolved item is not "still due".
		{"already substituted, deadline passed", ItemSubstituted, &past, false},
		{"already refunded, deadline passed", ItemRefunded, &past, false},
		{"still pending, no deadline", ItemPending, nil, false},
	}

	for _, tt := range tests {
		got := IsDueForExpiry(tt.status, tt.expiresAt, now)
		if got != tt.want {
			t.Errorf("%s: IsDueForExpiry(%s, %v, now) = %v, want %v", tt.name, tt.status, tt.expiresAt, got, tt.want)
		}
	}
}
