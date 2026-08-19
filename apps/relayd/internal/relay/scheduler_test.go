package relay

import (
	"context"
	"testing"
)

func TestPeerSchedulerPreservesSameStreamOrderAcrossPriorities(t *testing.T) {
	scheduler := newPeerScheduler(16, 16*1024, 1024)
	data := queuedEnvelope{data: []byte("response data"), size: 13}
	closeFrame := queuedEnvelope{data: []byte("stream close"), size: 12}

	if err := scheduler.enqueueLocked(data, PriorityData, "stream-a"); err != nil {
		t.Fatalf("enqueue data: %v", err)
	}
	if err := scheduler.enqueueLocked(closeFrame, PriorityControl, "stream-a"); err != nil {
		t.Fatalf("enqueue close: %v", err)
	}

	first, err := scheduler.next(context.Background())
	if err != nil {
		t.Fatalf("first next: %v", err)
	}
	second, err := scheduler.next(context.Background())
	if err != nil {
		t.Fatalf("second next: %v", err)
	}
	if string(first.data) != "response data" || string(second.data) != "stream close" {
		t.Fatalf("same-stream order = %q then %q", first.data, second.data)
	}
	if scheduler.queuedDataBytes != 0 || scheduler.queuedDataCount != 0 {
		t.Fatalf("data budget not released: bytes=%d count=%d", scheduler.queuedDataBytes, scheduler.queuedDataCount)
	}
}

func TestPeerSchedulerStillPrioritizesUnrelatedControl(t *testing.T) {
	scheduler := newPeerScheduler(16, 16*1024, 1024)
	data := queuedEnvelope{data: []byte("stream-a data"), size: 13}
	control := queuedEnvelope{data: []byte("stream-b ack"), size: 12}

	if err := scheduler.enqueueLocked(data, PriorityData, "stream-a"); err != nil {
		t.Fatalf("enqueue data: %v", err)
	}
	if err := scheduler.enqueueLocked(control, PriorityControl, "stream-b"); err != nil {
		t.Fatalf("enqueue control: %v", err)
	}

	first, err := scheduler.next(context.Background())
	if err != nil {
		t.Fatalf("next: %v", err)
	}
	if string(first.data) != "stream-b ack" {
		t.Fatalf("first item = %q, want unrelated control", first.data)
	}
}
