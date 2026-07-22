package relay

import (
	"fmt"
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
			frame := benchmarkV2Frame(b, payloadBytes)
			b.Run("legacy-parse-reencode", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(frame)))
				for b.Loop() {
					env, err := ParseEnvelope(frame, 1<<20)
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
			b.Run("v2-validated-passthrough", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(frame)))
				for b.Loop() {
					env, err := ParseEnvelopeView(frame, 1<<20)
					if err != nil {
						b.Fatal(err)
					}
					benchmarkForwardEnvelope = env
					benchmarkForwardBytes = frame
				}
			})
		})
	}
}

func benchmarkV2Frame(b *testing.B, payloadBytes int) []byte {
	b.Helper()
	payload := make([]byte, payloadBytes)
	for index := range payload {
		payload[index] = byte(index)
	}
	frame, err := EncodeEnvelope(Envelope{
		Version:  ProtocolVersion,
		RoomID:   "room_benchmark",
		Seq:      1,
		Kind:     KindRelayDataFrame,
		Priority: PriorityData,
		StreamID: "stream_benchmark",
		Payload:  payload,
	}, 1<<20)
	if err != nil {
		b.Fatal(err)
	}
	return frame
}
