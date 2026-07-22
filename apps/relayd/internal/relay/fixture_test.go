package relay

import (
	"errors"
	"testing"
)

func TestEnvelopeFixtures(t *testing.T) {
	valid, err := EncodeEnvelope(Envelope{Version: ProtocolVersion, RoomID: "fixture", Kind: KindRelayDataFrame, Priority: PriorityData, StreamID: "c1", Payload: []byte("opaque")}, 4096)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}
	if _, err := ParseEnvelope(valid, 4096); err != nil {
		t.Fatalf("ParseEnvelope() error = %v", err)
	}
	invalid := append([]byte(nil), valid...)
	invalid[3] = 0x80
	if _, err := ParseEnvelope(invalid, 4096); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("ParseEnvelope() error = %v, expected ErrInvalidEnvelope", err)
	}
}
