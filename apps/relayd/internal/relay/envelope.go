package relay

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
)

const (
	ProtocolVersion = 2

	KindRelayDataFrame = "relay_data_frame"
	KindPeerClosed     = "relay_peer_closed"
	KindRelayError     = "relay_error"

	PriorityControl = "control"
	PriorityData    = "data"

	envelopeHeaderBytes = 16
	flagHasStreamID     = 1
)

var (
	ErrInvalidEnvelope = errors.New("relay: invalid envelope")
	ErrFrameTooLarge   = errors.New("relay: frame too large")
)

// Envelope is the v2 outer binary relay frame. relayd can read only the room,
// stream id, and coarse priority needed for routing and fair scheduling. The
// payload is opaque endpoint-to-endpoint ciphertext after the initial hello.
type Envelope struct {
	Version  int
	RoomID   string
	Seq      uint32
	Kind     string
	Priority string
	StreamID string
	Payload  []byte
}

func ParseEnvelope(data []byte, maxBytes int64) (Envelope, error) {
	if maxBytes > 0 && int64(len(data)) > maxBytes {
		return Envelope{}, ErrFrameTooLarge
	}
	if len(data) < envelopeHeaderBytes {
		return Envelope{}, fmt.Errorf("%w: frame too short", ErrInvalidEnvelope)
	}
	if int(data[0]) != ProtocolVersion {
		return Envelope{}, fmt.Errorf("%w: unsupported protocol version", ErrInvalidEnvelope)
	}
	kind, ok := kindFromCode(data[1])
	if !ok {
		return Envelope{}, fmt.Errorf("%w: unknown kind", ErrInvalidEnvelope)
	}
	priority, ok := priorityFromCode(data[2])
	if !ok {
		return Envelope{}, fmt.Errorf("%w: invalid priority", ErrInvalidEnvelope)
	}
	flags := data[3]
	if flags & ^byte(flagHasStreamID) != 0 {
		return Envelope{}, fmt.Errorf("%w: invalid flags", ErrInvalidEnvelope)
	}
	roomLen := int(binary.BigEndian.Uint16(data[4:6]))
	streamLen := int(binary.BigEndian.Uint16(data[6:8]))
	seq := binary.BigEndian.Uint32(data[8:12])
	payloadLen := int(binary.BigEndian.Uint32(data[12:16]))
	expectedLen := envelopeHeaderBytes + roomLen + streamLen + payloadLen
	if roomLen == 0 || payloadLen == 0 || expectedLen != len(data) || (flags&flagHasStreamID != 0) != (streamLen > 0) {
		return Envelope{}, fmt.Errorf("%w: invalid field lengths", ErrInvalidEnvelope)
	}
	offset := envelopeHeaderBytes
	env := Envelope{
		Version:  ProtocolVersion,
		RoomID:   string(data[offset : offset+roomLen]),
		Seq:      seq,
		Kind:     kind,
		Priority: priority,
	}
	offset += roomLen
	if streamLen > 0 {
		env.StreamID = string(data[offset : offset+streamLen])
		offset += streamLen
	}
	env.Payload = append([]byte(nil), data[offset:]...)
	if err := env.Validate(maxBytes); err != nil {
		return Envelope{}, err
	}
	return env, nil
}

func (e Envelope) Validate(maxBytes int64) error {
	if e.Version != ProtocolVersion || e.RoomID == "" || e.Kind == "" || e.Priority == "" || len(e.Payload) == 0 {
		return fmt.Errorf("%w: required envelope field is missing", ErrInvalidEnvelope)
	}
	if _, ok := kindCode(e.Kind); !ok {
		return fmt.Errorf("%w: unknown kind", ErrInvalidEnvelope)
	}
	if _, ok := priorityCode(e.Priority); !ok {
		return fmt.Errorf("%w: invalid priority", ErrInvalidEnvelope)
	}
	if len(e.RoomID) > 0xffff || len(e.StreamID) > 0xffff {
		return fmt.Errorf("%w: identifier too long", ErrInvalidEnvelope)
	}
	if maxBytes > 0 && int64(envelopeHeaderBytes+len(e.RoomID)+len(e.StreamID)+len(e.Payload)) > maxBytes {
		return ErrFrameTooLarge
	}
	return nil
}

func EncodeEnvelope(e Envelope, maxBytes int64) ([]byte, error) {
	if e.Priority == "" {
		e.Priority = PriorityControl
	}
	if err := e.Validate(maxBytes); err != nil {
		return nil, err
	}
	kind, _ := kindCode(e.Kind)
	priority, _ := priorityCode(e.Priority)
	out := make([]byte, envelopeHeaderBytes+len(e.RoomID)+len(e.StreamID)+len(e.Payload))
	out[0] = ProtocolVersion
	out[1] = kind
	out[2] = priority
	if e.StreamID != "" {
		out[3] = flagHasStreamID
	}
	binary.BigEndian.PutUint16(out[4:6], uint16(len(e.RoomID)))
	binary.BigEndian.PutUint16(out[6:8], uint16(len(e.StreamID)))
	binary.BigEndian.PutUint32(out[8:12], e.Seq)
	binary.BigEndian.PutUint32(out[12:16], uint32(len(e.Payload)))
	offset := envelopeHeaderBytes
	copy(out[offset:], e.RoomID)
	offset += len(e.RoomID)
	copy(out[offset:], e.StreamID)
	offset += len(e.StreamID)
	copy(out[offset:], e.Payload)
	return out, nil
}

func RelayControlEnvelope(roomID string, kind string, payload any) (Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Envelope{}, fmt.Errorf("marshaling relay control payload: %w", err)
	}
	return Envelope{
		Version:  ProtocolVersion,
		RoomID:   roomID,
		Kind:     kind,
		Priority: PriorityControl,
		Payload:  raw,
	}, nil
}

func kindCode(kind string) (byte, bool) {
	switch kind {
	case KindRelayDataFrame:
		return 1, true
	case KindPeerClosed:
		return 2, true
	case KindRelayError:
		return 3, true
	default:
		return 0, false
	}
}

func kindFromCode(code byte) (string, bool) {
	switch code {
	case 1:
		return KindRelayDataFrame, true
	case 2:
		return KindPeerClosed, true
	case 3:
		return KindRelayError, true
	default:
		return "", false
	}
}

func priorityCode(priority string) (byte, bool) {
	switch priority {
	case PriorityControl:
		return 1, true
	case PriorityData:
		return 2, true
	default:
		return 0, false
	}
}

func priorityFromCode(code byte) (string, bool) {
	switch code {
	case 1:
		return PriorityControl, true
	case 2:
		return PriorityData, true
	default:
		return "", false
	}
}
