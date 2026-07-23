package relay

import (
	"context"
	"errors"
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

func TestHubForwardQueuesOriginalValidatedFrame(t *testing.T) {
	now := time.Unix(1000, 0)
	hub := newTestHub(func() time.Time { return now })
	frame, err := EncodeEnvelope(Envelope{
		Version:  ProtocolVersion,
		RoomID:   "room_forward",
		Seq:      7,
		Kind:     KindRelayDataFrame,
		Priority: PriorityData,
		StreamID: "stream_1",
		Payload:  []byte("opaque ciphertext"),
	}, hub.cfg.MaxFrameBytes)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}
	env, err := ParseEnvelopeView(frame, hub.cfg.MaxFrameBytes)
	if err != nil {
		t.Fatalf("ParseEnvelopeView() error = %v", err)
	}
	from := &connState{role: RoleHost, roomID: env.RoomID, cfg: hub.cfg}
	peer := &connState{
		role:      RoleController,
		roomID:    env.RoomID,
		scheduler: newPeerScheduler(hub.cfg.MaxQueuedEnvelopes, hub.cfg.MaxQueuedBytes, hub.cfg.MaxFrameBytes),
	}
	hub.rooms[env.RoomID] = &room{id: env.RoomID, host: from, controller: peer}

	if err := hub.forward(t.Context(), from, frame, env); err != nil {
		t.Fatalf("forward() error = %v", err)
	}
	item, err := peer.scheduler.next(t.Context())
	if err != nil {
		t.Fatalf("scheduler.next() error = %v", err)
	}
	if string(item.data) != string(frame) {
		t.Fatalf("forwarded bytes differ from original frame")
	}
	if &item.data[0] != &frame[0] {
		t.Fatal("forwarded frame does not retain the original byte slice")
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
	scheduler := newPeerScheduler(8, 4096, 1024)
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

func TestPeerSchedulerReservesCapacityForControlAndPrunesDrainedStreams(t *testing.T) {
	scheduler := newPeerScheduler(4, 4096, 1024)
	for index := 0; index < 3; index++ {
		if err := scheduler.enqueue(queuedEnvelope{data: []byte("bulk"), size: 1024}, PriorityData, "bulk"); err != nil {
			t.Fatalf("enqueue reserved data %d: %v", index, err)
		}
	}
	if err := scheduler.enqueue(queuedEnvelope{data: []byte("overflow"), size: 1024}, PriorityData, "bulk"); !errors.Is(err, ErrSlowConsumer) {
		t.Fatalf("enqueue data into control reserve = %v, expected ErrSlowConsumer", err)
	}
	if err := scheduler.enqueue(queuedEnvelope{data: []byte("ack"), size: 1024}, PriorityControl, ""); err != nil {
		t.Fatalf("enqueue control into reserved capacity: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	first, err := scheduler.next(ctx)
	if err != nil {
		t.Fatalf("next control: %v", err)
	}
	if got := string(first.data); got != "ack" {
		t.Fatalf("next control = %q, expected ack", got)
	}
	for range 3 {
		if _, err := scheduler.next(ctx); err != nil {
			t.Fatalf("drain data: %v", err)
		}
	}
	if got := len(scheduler.streamOrder); got != 0 {
		t.Fatalf("streamOrder retains drained streams: %d", got)
	}
	if got := len(scheduler.dataByStream); got != 0 {
		t.Fatalf("dataByStream retains drained streams: %d", got)
	}
}

func TestPeerSchedulerBackpressuresAndResumesDataInsteadOfDroppingPeer(t *testing.T) {
	scheduler := newPeerScheduler(4, 4096, 1024)
	for index := range 3 {
		if err := scheduler.enqueue(queuedEnvelope{data: []byte{byte(index)}, size: 1024}, PriorityData, "bulk"); err != nil {
			t.Fatalf("fill data queue %d: %v", index, err)
		}
	}

	done := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		result <- scheduler.enqueueWait(
			t.Context(),
			done,
			queuedEnvelope{data: []byte("next"), size: 1024},
			PriorityData,
			"bulk",
		)
	}()

	select {
	case err := <-result:
		t.Fatalf("enqueueWait returned before queue space was available: %v", err)
	default:
	}
	if _, err := scheduler.next(t.Context()); err != nil {
		t.Fatalf("drain one queued frame: %v", err)
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("enqueueWait after drain: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("enqueueWait did not resume after queue space became available")
	}
}

func TestPeerSchedulerBackpressureStopsWhenContextIsCancelled(t *testing.T) {
	scheduler := newPeerScheduler(4, 4096, 1024)
	for index := range 3 {
		if err := scheduler.enqueue(queuedEnvelope{data: []byte{byte(index)}, size: 1024}, PriorityData, "bulk"); err != nil {
			t.Fatalf("fill data queue %d: %v", index, err)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	err := scheduler.enqueueWait(
		ctx,
		make(chan struct{}),
		queuedEnvelope{data: []byte("next"), size: 1024},
		PriorityData,
		"bulk",
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("enqueueWait cancellation error = %v, expected context.Canceled", err)
	}
}
