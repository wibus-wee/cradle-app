package relay

import (
	"context"
	"testing"
	"time"
)

const (
	testHostPubkey       = "host_pubkey"
	testControllerPubkey = "controller_pubkey"
)

func newTestHub(now func() time.Time) *Hub {
	return NewHub(HubConfig{
		RoomTTL:            time.Minute,
		MaxRooms:           16,
		MaxFrameBytes:      1024,
		MaxQueuedEnvelopes: 4,
		MaxQueuedBytes:     4096,
		HeartbeatInterval:  time.Second,
		IdleTimeout:        3 * time.Second,
		Now:                now,
	})
}

func TestHubIdleRoomExpiresPastTTL(t *testing.T) {
	now := time.Unix(1000, 0)
	hub := newTestHub(func() time.Time { return now })

	roomID := "room_idle"
	if err := hub.CreateRoom(context.Background(), roomID, now.Add(time.Minute), testHostPubkey, ""); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}

	// Advance well past TTL with no peers connected.
	now = now.Add(2 * time.Minute)
	if removed := hub.expireLocked(now); removed != 1 {
		t.Fatalf("Expire() removed = %d, expected 1", removed)
	}
	hub.mu.Lock()
	_, ok := hub.rooms[roomID]
	hub.mu.Unlock()
	if ok {
		t.Fatal("idle room should have been removed")
	}
}

func TestHubActiveRoomIsRenewedPastTTL(t *testing.T) {
	now := time.Unix(1000, 0)
	hub := newTestHub(func() time.Time { return now })

	roomID := "room_active"
	if err := hub.CreateRoom(context.Background(), roomID, now.Add(time.Minute), testHostPubkey, ""); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	// Attach an active host peer so the room is considered in use.
	hub.mu.Lock()
	hub.rooms[roomID].host = &connState{role: RoleHost, roomID: roomID}
	hub.mu.Unlock()

	// Advance past TTL — the active room must be extended, not removed.
	now = now.Add(2 * time.Minute)
	if removed := hub.expireLocked(now); removed != 0 {
		t.Fatalf("Expire() removed = %d, expected 0 for active room", removed)
	}
	hub.mu.Lock()
	room, ok := hub.rooms[roomID]
	hub.mu.Unlock()
	if !ok {
		t.Fatal("active room was expired")
	}
	if !room.expiresAt.After(now) {
		t.Fatalf("expiresAt not renewed past now: got %v, now %v", room.expiresAt, now)
	}
	if room.host == nil {
		t.Fatal("active host peer was lost during renewal")
	}
}

func TestHubRenewRoomExtendsExpiry(t *testing.T) {
	now := time.Unix(1000, 0)
	hub := newTestHub(func() time.Time { return now })

	roomID := "room_renew"
	if err := hub.CreateRoom(context.Background(), roomID, now.Add(time.Minute), testHostPubkey, ""); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}

	now = now.Add(30 * time.Second)
	hub.renewRoom(roomID, now)

	hub.mu.Lock()
	room := hub.rooms[roomID]
	hub.mu.Unlock()
	if room.expiresAt != now.Add(time.Minute) {
		t.Fatalf("expiresAt = %v, expected %v", room.expiresAt, now.Add(time.Minute))
	}
}

func TestHubCreateRoomIdempotentRenews(t *testing.T) {
	now := time.Unix(1000, 0)
	hub := newTestHub(func() time.Time { return now })

	roomID := "room_idempotent"
	firstExpiry := now.Add(time.Minute)
	if err := hub.CreateRoom(context.Background(), roomID, firstExpiry, testHostPubkey, ""); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	// Re-creating the same room with a later expiry updates it in place — this
	// is the path POST /rooms/host-session uses for reconnect.
	laterExpiry := now.Add(time.Hour)
	if err := hub.CreateRoom(context.Background(), roomID, laterExpiry, testHostPubkey, testControllerPubkey); err != nil {
		t.Fatalf("CreateRoom() second call error = %v", err)
	}
	hub.mu.Lock()
	room := hub.rooms[roomID]
	hub.mu.Unlock()
	if room.expiresAt != laterExpiry {
		t.Fatalf("expiresAt = %v, expected %v (renewed)", room.expiresAt, laterExpiry)
	}
	if room.createdAt.IsZero() {
		t.Fatal("createdAt should be preserved across idempotent renewal")
	}
}

func TestPeerSchedulerPrioritizesControlAndRoundRobinsDataStreams(t *testing.T) {
	scheduler := newPeerScheduler(8, 4096)
	for _, item := range []struct{ stream, data string }{
		{"a", "a1"}, {"a", "a2"}, {"b", "b1"},
	} {
		if err := scheduler.enqueue(queuedEnvelope{data: []byte(item.data), size: int64(len(item.data))}, PriorityData, item.stream); err != nil {
			t.Fatalf("enqueue data: %v", err)
		}
	}
	if err := scheduler.enqueue(queuedEnvelope{data: []byte("ack"), size: 3}, PriorityControl, ""); err != nil {
		t.Fatalf("enqueue control: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	want := []string{"ack", "a1", "b1", "a2"}
	for _, expected := range want {
		item, err := scheduler.next(ctx)
		if err != nil {
			t.Fatalf("next() error = %v", err)
		}
		if got := string(item.data); got != expected {
			t.Fatalf("next() = %q, expected %q", got, expected)
		}
	}
}
