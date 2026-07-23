package relay

import (
	"errors"
	"testing"
)

func TestParseEnvelope(t *testing.T) {
	data, err := EncodeEnvelope(Envelope{
		Version:  ProtocolVersion,
		RoomID:   "room_1",
		Seq:      1,
		Kind:     KindRelayDataFrame,
		Priority: PriorityControl,
		Payload:  []byte("hello"),
	}, 1024)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}

	env, err := ParseEnvelope(data, 1024)
	if err != nil {
		t.Fatalf("ParseEnvelope() error = %v", err)
	}
	if env.RoomID != "room_1" {
		t.Fatalf("env.RoomID = %q, expected room_1", env.RoomID)
	}
}

func TestParseEnvelopeViewAliasesPayloadWhileParseEnvelopeOwnsCopy(t *testing.T) {
	data, err := EncodeEnvelope(Envelope{
		Version:  ProtocolVersion,
		RoomID:   "room_1",
		Seq:      1,
		Kind:     KindRelayDataFrame,
		Priority: PriorityControl,
		Payload:  []byte("hello"),
	}, 1024)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}

	view, err := ParseEnvelopeView(data, 1024)
	if err != nil {
		t.Fatalf("ParseEnvelopeView() error = %v", err)
	}
	owned, err := ParseEnvelope(data, 1024)
	if err != nil {
		t.Fatalf("ParseEnvelope() error = %v", err)
	}

	data[len(data)-1] = 'X'
	if got := string(view.Payload); got != "hellX" {
		t.Fatalf("view payload = %q, expected alias to mutated input", got)
	}
	if got := string(owned.Payload); got != "hello" {
		t.Fatalf("owned payload = %q, expected detached copy", got)
	}
}

func TestParseEnvelopeRejectsInvalidVersion(t *testing.T) {
	data, err := EncodeEnvelope(Envelope{
		Version:  99,
		RoomID:   "room_1",
		Seq:      1,
		Kind:     KindRelayDataFrame,
		Priority: PriorityControl,
		Payload:  []byte("hello"),
	}, 1024)
	if err == nil {
		t.Fatal("EncodeEnvelope() unexpectedly accepted an invalid version")
	}
	data = append([]byte{99}, make([]byte, envelopeHeaderBytes-1)...)

	_, err = ParseEnvelope(data, 1024)
	if !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("ParseEnvelope() error = %v, expected ErrInvalidEnvelope", err)
	}
}

func TestParseEnvelopeRejectsOversizedFrame(t *testing.T) {
	_, err := ParseEnvelope([]byte(`{"version":1}`), 4)
	if !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("ParseEnvelope() error = %v, expected ErrFrameTooLarge", err)
	}
}
