package relay

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestParseEnvelope(t *testing.T) {
	payload, err := json.Marshal(map[string]string{"kind": "host/hello"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	data, err := json.Marshal(Envelope{
		Version: ProtocolVersion,
		RoomID:  "room_1",
		Seq:     1,
		Kind:    KindRelayDataFrame,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	env, err := ParseEnvelope(data, 1024)
	if err != nil {
		t.Fatalf("ParseEnvelope() error = %v", err)
	}
	if env.RoomID != "room_1" {
		t.Fatalf("env.RoomID = %q, expected room_1", env.RoomID)
	}
}

func TestParseEnvelopeRejectsInvalidVersion(t *testing.T) {
	payload, err := json.Marshal(map[string]string{"kind": "host/hello"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	data, err := json.Marshal(Envelope{
		Version: 99,
		RoomID:  "room_1",
		Seq:     1,
		Kind:    KindRelayDataFrame,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

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
