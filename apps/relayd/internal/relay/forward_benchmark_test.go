package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"testing"
)

var (
	benchmarkForwardEnvelope Envelope
	benchmarkForwardBytes    []byte
)

// BenchmarkRelayForwardPath compares the exact V2 Relay work before and after
// pass-through forwarding. It intentionally measures only Relay-process work,
// not Internet throughput: legacy copies the opaque payload and recreates a
// frame; the V2 path validates metadata and queues the received frame itself.
func BenchmarkRelayForwardPath(b *testing.B) {
	for _, payloadBytes := range []int{1 << 10, 64 << 10, 256 << 10} {
		b.Run(fmt.Sprintf("%dKiB", payloadBytes>>10), func(b *testing.B) {
			v1Frame := benchmarkV1Frame(b, payloadBytes)
			v2Frame := benchmarkV2Frame(b, payloadBytes)
			b.Run("v1-json-parse-reencode", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(v1Frame)))
				for b.Loop() {
					env, err := parseBenchmarkV1Envelope(v1Frame, 1<<20)
					if err != nil {
						b.Fatal(err)
					}
					forwarded, err := encodeBenchmarkV1Envelope(env, 1<<20)
					if err != nil {
						b.Fatal(err)
					}
					benchmarkForwardEnvelope = Envelope{Payload: env.Payload}
					benchmarkForwardBytes = forwarded
				}
			})
			b.Run("v2-before-parse-reencode", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(v2Frame)))
				for b.Loop() {
					env, err := ParseEnvelope(v2Frame, 1<<20)
					if err != nil {
						b.Fatal(err)
					}
					forwarded, err := EncodeEnvelope(env, 1<<20)
					if err != nil {
						b.Fatal(err)
					}
					benchmarkForwardEnvelope = env
					benchmarkForwardBytes = forwarded
				}
			})
			b.Run("v2-current-validated-passthrough", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(v2Frame)))
				for b.Loop() {
					env, err := ParseEnvelopeView(v2Frame, 1<<20)
					if err != nil {
						b.Fatal(err)
					}
					benchmarkForwardEnvelope = env
					benchmarkForwardBytes = v2Frame
				}
			})
		})
	}
}

func benchmarkV2Frame(b *testing.B, payloadBytes int) []byte {
	b.Helper()
	// V2 stream_data plaintext is one byte kind, two bytes stream-id length,
	// four bytes sequence, the stream id, and payload. XChaCha20-Poly1305 adds
	// a 24-byte nonce plus a 16-byte authentication tag. relayd only sees the
	// resulting opaque payload, so a deterministic byte slice has the exact
	// relevant length without doing endpoint cryptography in this Go benchmark.
	payload := make([]byte, payloadBytes+7+len("benchmark")+24+16)
	for index := range payload {
		payload[index] = byte(index)
	}
	frame, err := EncodeEnvelope(Envelope{
		Version:  ProtocolVersion,
		RoomID:   "room_benchmark",
		Seq:      1,
		Kind:     KindRelayDataFrame,
		Priority: PriorityData,
		StreamID: "benchmark",
		Payload:  payload,
	}, 1<<20)
	if err != nil {
		b.Fatal(err)
	}
	return frame
}

// benchmarkV1Envelope mirrors the historical JSON envelope from the parent of
// commit 9c437fde. It exists only in this benchmark so production supports one
// protocol: V2.
type benchmarkV1Envelope struct {
	Version  int             `json:"version"`
	RoomID   string          `json:"roomId"`
	Seq      uint64          `json:"seq"`
	Ack      *uint64         `json:"ack,omitempty"`
	Kind     string          `json:"kind"`
	StreamID string          `json:"streamId,omitempty"`
	Payload  json.RawMessage `json:"payload"`
}

func benchmarkV1Frame(b *testing.B, payloadBytes int) []byte {
	b.Helper()
	data := make([]byte, payloadBytes)
	for index := range data {
		data[index] = byte(index)
	}
	inner, err := json.Marshal(struct {
		Kind     string `json:"kind"`
		StreamID string `json:"streamId"`
		Seq      uint64 `json:"seq"`
		Data     string `json:"data"`
	}{
		Kind:     "stream_data",
		StreamID: "benchmark",
		Seq:      0,
		Data:     base64.StdEncoding.EncodeToString(data),
	})
	if err != nil {
		b.Fatal(err)
	}
	// V1 wrapped nonce(24) || ciphertext || tag(16) as base64 JSON. A zeroed
	// nonce/tag keeps this benchmark deterministic while preserving wire length.
	ciphertext := make([]byte, 24+len(inner)+16)
	copy(ciphertext[24:], inner)
	payload, err := json.Marshal(struct {
		Ciphertext string `json:"ciphertext"`
	}{Ciphertext: base64.StdEncoding.EncodeToString(ciphertext)})
	if err != nil {
		b.Fatal(err)
	}
	frame, err := encodeBenchmarkV1Envelope(benchmarkV1Envelope{
		Version: 1,
		RoomID:  "room_benchmark",
		Seq:     1,
		Kind:    KindRelayDataFrame,
		Payload: payload,
	}, 1<<20)
	if err != nil {
		b.Fatal(err)
	}
	return frame
}

func parseBenchmarkV1Envelope(data []byte, maxBytes int64) (benchmarkV1Envelope, error) {
	if maxBytes > 0 && int64(len(data)) > maxBytes {
		return benchmarkV1Envelope{}, ErrFrameTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var env benchmarkV1Envelope
	if err := decoder.Decode(&env); err != nil {
		return benchmarkV1Envelope{}, fmt.Errorf("%w: %v", ErrInvalidEnvelope, err)
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return benchmarkV1Envelope{}, ErrInvalidEnvelope
	}
	if err := validateBenchmarkV1Envelope(env, maxBytes); err != nil {
		return benchmarkV1Envelope{}, err
	}
	return env, nil
}

func encodeBenchmarkV1Envelope(env benchmarkV1Envelope, maxBytes int64) ([]byte, error) {
	if err := validateBenchmarkV1Envelope(env, maxBytes); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(env)
	if err != nil {
		return nil, fmt.Errorf("marshaling benchmark v1 envelope: %w", err)
	}
	return encoded, nil
}

func validateBenchmarkV1Envelope(env benchmarkV1Envelope, maxBytes int64) error {
	if env.Version != 1 || env.RoomID == "" || env.Kind == "" || len(env.Payload) == 0 {
		return ErrInvalidEnvelope
	}
	if env.Kind != KindRelayDataFrame && env.Kind != KindPeerClosed && env.Kind != KindRelayError {
		return ErrInvalidEnvelope
	}
	if maxBytes > 0 {
		encoded, err := json.Marshal(env)
		if err != nil {
			return fmt.Errorf("marshaling benchmark v1 envelope: %w", err)
		}
		if int64(len(encoded)) > maxBytes {
			return ErrFrameTooLarge
		}
	}
	return nil
}
