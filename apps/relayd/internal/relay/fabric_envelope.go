package relay

import (
	"encoding/binary"
	"fmt"
)

const (
	FabricProtocolVersion = 3
	fabricEnvelopeHeader  = 24
)

const (
	FabricKindLinkOpen   = "link_open"
	FabricKindLinkReady  = "link_ready"
	FabricKindData       = "relay_data_frame"
	FabricKindPeerClosed = "relay_peer_closed"
	FabricKindError      = "relay_error"
)

// FabricEnvelope is the v3 outer frame. The relay learns only Fabric, Node,
// Link and stream routing fields; payload stays end-to-end encrypted.
type FabricEnvelope struct {
	Version  int
	FabricID string
	NodeID   string
	LinkID   string
	StreamID string
	Seq      uint32
	Ack      uint32
	Kind     string
	Priority string
	Payload  []byte
}

func ParseFabricEnvelopeView(data []byte, maxBytes int64) (FabricEnvelope, error) {
	if maxBytes > 0 && int64(len(data)) > maxBytes {
		return FabricEnvelope{}, ErrFrameTooLarge
	}
	if len(data) < fabricEnvelopeHeader || int(data[0]) != FabricProtocolVersion {
		return FabricEnvelope{}, ErrInvalidEnvelope
	}
	kind, ok := fabricKindFromCode(data[1])
	if !ok {
		return FabricEnvelope{}, ErrInvalidEnvelope
	}
	priority, ok := priorityFromCode(data[2])
	if !ok {
		return FabricEnvelope{}, ErrInvalidEnvelope
	}
	fabricLen := int(binary.BigEndian.Uint16(data[4:6]))
	nodeLen := int(binary.BigEndian.Uint16(data[6:8]))
	linkLen := int(binary.BigEndian.Uint16(data[8:10]))
	streamLen := int(binary.BigEndian.Uint16(data[10:12]))
	seq := binary.BigEndian.Uint32(data[12:16])
	ack := binary.BigEndian.Uint32(data[16:20])
	payloadLen := int(binary.BigEndian.Uint32(data[20:24]))
	expected := fabricEnvelopeHeader + fabricLen + nodeLen + linkLen + streamLen + payloadLen
	if fabricLen == 0 || nodeLen == 0 || linkLen == 0 || payloadLen == 0 || expected != len(data) {
		return FabricEnvelope{}, ErrInvalidEnvelope
	}
	offset := fabricEnvelopeHeader
	env := FabricEnvelope{
		Version: FabricProtocolVersion, FabricID: string(data[offset : offset+fabricLen]),
		Seq: seq, Ack: ack, Kind: kind, Priority: priority,
	}
	offset += fabricLen
	env.NodeID = string(data[offset : offset+nodeLen])
	offset += nodeLen
	env.LinkID = string(data[offset : offset+linkLen])
	offset += linkLen
	env.StreamID = string(data[offset : offset+streamLen])
	offset += streamLen
	env.Payload = data[offset:]
	if err := env.Validate(maxBytes); err != nil {
		return FabricEnvelope{}, err
	}
	return env, nil
}

func EncodeFabricEnvelope(env FabricEnvelope, maxBytes int64) ([]byte, error) {
	if env.Priority == "" {
		env.Priority = PriorityControl
	}
	if err := env.Validate(maxBytes); err != nil {
		return nil, err
	}
	kind, _ := fabricKindCode(env.Kind)
	priority, _ := priorityCode(env.Priority)
	out := make([]byte, fabricEnvelopeHeader+len(env.FabricID)+len(env.NodeID)+len(env.LinkID)+len(env.StreamID)+len(env.Payload))
	out[0], out[1], out[2] = FabricProtocolVersion, kind, priority
	binary.BigEndian.PutUint16(out[4:6], uint16(len(env.FabricID)))
	binary.BigEndian.PutUint16(out[6:8], uint16(len(env.NodeID)))
	binary.BigEndian.PutUint16(out[8:10], uint16(len(env.LinkID)))
	binary.BigEndian.PutUint16(out[10:12], uint16(len(env.StreamID)))
	binary.BigEndian.PutUint32(out[12:16], env.Seq)
	binary.BigEndian.PutUint32(out[16:20], env.Ack)
	binary.BigEndian.PutUint32(out[20:24], uint32(len(env.Payload)))
	offset := fabricEnvelopeHeader
	for _, field := range []string{env.FabricID, env.NodeID, env.LinkID, env.StreamID} {
		copy(out[offset:], field)
		offset += len(field)
	}
	copy(out[offset:], env.Payload)
	return out, nil
}

func (env FabricEnvelope) Validate(maxBytes int64) error {
	if env.Version != FabricProtocolVersion || env.FabricID == "" || env.NodeID == "" || env.LinkID == "" || env.Kind == "" || env.Priority == "" || len(env.Payload) == 0 {
		return ErrInvalidEnvelope
	}
	if _, ok := fabricKindCode(env.Kind); !ok {
		return ErrInvalidEnvelope
	}
	if _, ok := priorityCode(env.Priority); !ok {
		return ErrInvalidEnvelope
	}
	for _, value := range []string{env.FabricID, env.NodeID, env.LinkID, env.StreamID} {
		if len(value) > 0xffff {
			return fmt.Errorf("%w: identifier too long", ErrInvalidEnvelope)
		}
	}
	if maxBytes > 0 && int64(fabricEnvelopeHeader+len(env.FabricID)+len(env.NodeID)+len(env.LinkID)+len(env.StreamID)+len(env.Payload)) > maxBytes {
		return ErrFrameTooLarge
	}
	return nil
}

func fabricKindCode(kind string) (byte, bool) {
	switch kind {
	case FabricKindLinkOpen:
		return 1, true
	case FabricKindLinkReady:
		return 2, true
	case FabricKindData:
		return 3, true
	case FabricKindPeerClosed:
		return 4, true
	case FabricKindError:
		return 5, true
	default:
		return 0, false
	}
}

func fabricKindFromCode(code byte) (string, bool) {
	for _, kind := range []string{FabricKindLinkOpen, FabricKindLinkReady, FabricKindData, FabricKindPeerClosed, FabricKindError} {
		if candidate, ok := fabricKindCode(kind); ok && candidate == code {
			return kind, true
		}
	}
	return "", false
}
