package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const (
	ProtocolVersion = 1

	KindRelayDataFrame = "relay_data_frame"
	KindPeerClosed       = "relay_peer_closed"
	KindRelayError       = "relay_error"
)

var (
	ErrInvalidEnvelope = errors.New("relay: invalid envelope")
	ErrFrameTooLarge   = errors.New("relay: frame too large")
)

type Envelope struct {
	Version  int             `json:"version"`
	RoomID   string          `json:"roomId"`
	Seq      uint64          `json:"seq"`
	Ack      *uint64         `json:"ack,omitempty"`
	Kind     string          `json:"kind"`
	StreamID string          `json:"streamId,omitempty"`
	Payload  json.RawMessage `json:"payload"`
}

func ParseEnvelope(data []byte, maxBytes int64) (Envelope, error) {
	if maxBytes > 0 && int64(len(data)) > maxBytes {
		return Envelope{}, ErrFrameTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var env Envelope
	if err := decoder.Decode(&env); err != nil {
		return Envelope{}, fmt.Errorf("%w: %v", ErrInvalidEnvelope, err)
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return Envelope{}, ErrInvalidEnvelope
	}
	if err := env.Validate(maxBytes); err != nil {
		return Envelope{}, err
	}
	return env, nil
}

func (e Envelope) Validate(maxBytes int64) error {
	if e.Version != ProtocolVersion {
		return fmt.Errorf("%w: unsupported protocol version", ErrInvalidEnvelope)
	}
	if e.RoomID == "" {
		return fmt.Errorf("%w: room id is required", ErrInvalidEnvelope)
	}
	if e.Kind == "" {
		return fmt.Errorf("%w: kind is required", ErrInvalidEnvelope)
	}
	switch e.Kind {
	case KindRelayDataFrame, KindPeerClosed, KindRelayError:
	default:
		return fmt.Errorf("%w: unknown kind", ErrInvalidEnvelope)
	}
	if len(e.Payload) == 0 {
		return fmt.Errorf("%w: payload is required", ErrInvalidEnvelope)
	}
	if maxBytes > 0 {
		encoded, err := json.Marshal(e)
		if err != nil {
			return fmt.Errorf("marshaling envelope: %w", err)
		}
		if int64(len(encoded)) > maxBytes {
			return ErrFrameTooLarge
		}
	}
	return nil
}

func EncodeEnvelope(e Envelope, maxBytes int64) ([]byte, error) {
	if err := e.Validate(maxBytes); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(e)
	if err != nil {
		return nil, fmt.Errorf("marshaling envelope: %w", err)
	}
	return encoded, nil
}

func RelayControlEnvelope(roomID string, kind string, payload any) (Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, fmt.Errorf("marshaling relay control payload: %w", err)
	}
	return Envelope{
		Version: ProtocolVersion,
		RoomID:  roomID,
		Seq:     0,
		Kind:    kind,
		Payload: raw,
	}, nil
}
